/**
 * 待办服务：清单枚举、新建、删除与条目增删改，把文件操作收敛成协议可直接回传的详情。
 * 复用约定：md 编解码交给 ./todoMarkdown，文件访问交给 ./todoRepository；
 * 激活清单记在 globalState（面板重开后仍在原清单），写操作按清单串行排队。
 * 关键约束：写操作一律先重读文件再改目标行，绝不基于缓存整篇覆盖；
 * 条目定位先按序号、再按文本回查，两处都对不上时抛「已在外部修改」，避免误删相邻条目；
 * 清单 id 必须命中目录扫描结果才可用，前端传什么都不能直接拼路径。
 */
import * as vscode from 'vscode'
import { logger } from '@modules/common/logger'
import {
    isTodoItemDeleteRequest,
    isTodoItemToggleRequest,
    isTodoItemsAddRequest,
    isTodoListRenameRequest,
    isTodoListRequest,
    MAX_TODO_TEXTS,
} from '@shared/types/todo'
import type { TodoItem, TodoListDetail, TodoListSummary, TodoListsSnapshot } from '@shared/types/todo'
import {
    appendTodoLines,
    buildTodoListContent,
    joinTodoLines,
    normalizeTodoText,
    parseTodoMarkdown,
    removeTodoLine,
    replaceHeading,
    splitTodoLines,
    toggleTodoLine,
    type TodoMarkdownEntry,
} from './todoMarkdown'
import { normalizeListId, type TodoRepository } from './todoRepository'

/** 激活清单的持久化键：面板重开后定位到上次查看的清单 */
const ACTIVE_LIST_KEY = 'zhai.todo.activeList'

/** 首次进入时自动创建的清单名：用户删空后不再重建，空态由页面承接 */
const DEFAULT_LIST_NAME = '待办 1'

/** 清单名序号模板：新建时取现有最大值 +1，避免与手工改过的名字相撞 */
const LIST_NAME_PATTERN = /^待办\s*(\d+)$/u

/** 程序写入后的静默窗口：监听器据此忽略自身写入，避免刚写完就触发一次重复刷新 */
const WRITE_QUIET_WINDOW_MS = 800

/** 定位条目：先按序号命中，序号与文本不符时按文本唯一回查 */
function resolveEntry(entries: readonly TodoMarkdownEntry[], index: number, text: string): TodoMarkdownEntry {
    const byIndex = entries[index]
    if (byIndex !== undefined && byIndex.text === text) {
        return byIndex
    }
    const matches = entries.filter((entry) => entry.text === text)
    const [target] = matches
    if (matches.length !== 1 || target === undefined) {
        throw new Error('清单已在外部修改，请刷新后重试')
    }
    return target
}

export class TodoService implements vscode.Disposable {
    /** 外部变更事件：文件监听在 todo 目录变化时触发，供面板广播刷新 */
    private readonly changeEmitter = new vscode.EventEmitter<void>()
    /** 按清单串行排队：同一清单的读改写不并发，不同清单互不阻塞 */
    private readonly queue = new Map<string, Promise<void>>()
    /** 最近一次程序写入的时间戳：监听器据此跳过自身写入 */
    private lastWriteAt = 0

    public readonly onDidChange: vscode.Event<void> = this.changeEmitter.event

    public constructor(
        private readonly repository: TodoRepository,
        private readonly state: vscode.Memento,
    ) {}

    /**
     * 清单快照：目录从未创建时先建一份默认清单，目录存在但已删空则返回空列表。
     * 关键约束：以「目录是否存在」区分首次初始化与用户主动删空，避免删光后又被自动建回来。
     */
    public async lists(): Promise<TodoListsSnapshot> {
        let ids = await this.repository.listIds()
        if (ids.length === 0 && !(await this.repository.hasDirectory())) {
            await this.repository.createFile(DEFAULT_LIST_NAME, buildTodoListContent(DEFAULT_LIST_NAME))
            ids = [DEFAULT_LIST_NAME]
        }
        const lists: TodoListSummary[] = []
        for (const id of ids) {
            const summary = await this.readSummary(id)
            if (summary !== null) {
                lists.push(summary)
            }
        }
        const stored = this.state.get<string>(ACTIVE_LIST_KEY)
        const isStoredValid = stored !== undefined && lists.some((list) => list.id === stored)
        const activeListId = isStoredValid ? stored : (lists[0]?.id ?? null)
        if (activeListId !== stored) {
            await this.state.update(ACTIVE_LIST_KEY, activeListId)
        }
        return { lists, activeListId, dirPath: this.repository.dirPath() }
    }

    /** 读取清单详情：id 须是真实文件，读取失败即抛错，不回退成空清单 */
    public async detail(payload: unknown): Promise<TodoListDetail> {
        if (!isTodoListRequest(payload)) {
            throw new Error('待办清单参数非法')
        }
        const listId = payload.listId
        await this.assertExisting(listId)
        return this.readDetail(listId)
    }

    /** 新建清单：名字取「待办 N」的下一号，创建后立即激活 */
    public async createList(): Promise<TodoListDetail> {
        const ids = await this.repository.listIds()
        const name = this.nextListName(ids)
        await this.repository.createFile(name, buildTodoListContent(name))
        await this.state.update(ACTIVE_LIST_KEY, name)
        return this.readDetail(name)
    }

    /** 删除清单：文件移入回收站，激活项由随后的快照重新裁决 */
    public async deleteList(payload: unknown): Promise<TodoListsSnapshot> {
        if (!isTodoListRequest(payload)) {
            throw new Error('待办清单参数非法')
        }
        const listId = payload.listId
        await this.assertExisting(listId)
        await this.repository.deleteFile(listId)
        return this.lists()
    }

    /**
     * 重命名清单：文件名即清单名，改名后同步文件内的一级标题。
     * 关键约束：新名经 normalizeListId 校验（长度、保留字符、点开头）并确认不与现有文件重名；
     * 顺序为「改名 → 改写标题 → 更新激活项」，标题写失败时清单名已生效——读写只认文件名，功能不受影响。
     */
    public async renameList(payload: unknown): Promise<TodoListDetail> {
        if (!isTodoListRenameRequest(payload)) {
            throw new Error('重命名参数非法')
        }
        const { listId, name } = payload
        await this.assertExisting(listId)
        const nextId = normalizeListId(name)
        if (nextId === listId) {
            return this.readDetail(listId)
        }
        return this.enqueue(listId, async () => {
            await this.repository.renameFile(listId, nextId)
            const content = await this.repository.readContent(nextId)
            await this.write(nextId, joinTodoLines(replaceHeading(splitTodoLines(content), nextId)))
            await this.state.update(ACTIVE_LIST_KEY, nextId)
            return this.readDetail(nextId)
        })
    }

    /** 新增待办：按行拆分后的文本逐条追加，空文本与重复文本在同批次内去重 */
    public async addItems(payload: unknown): Promise<TodoListDetail> {
        if (!isTodoItemsAddRequest(payload)) {
            throw new Error('新增待办参数非法')
        }
        const listId = payload.listId
        await this.assertExisting(listId)
        const texts = [
            ...new Set(payload.texts.map((text) => normalizeTodoText(text)).filter((text) => text.length > 0)),
        ]
        if (texts.length === 0) {
            throw new Error('待办内容不能为空')
        }
        const limited = texts.slice(0, MAX_TODO_TEXTS)
        return this.enqueue(listId, async () => {
            const content = await this.repository.readContent(listId)
            const lines = appendTodoLines(splitTodoLines(content), limited)
            await this.write(listId, joinTodoLines(lines))
            return this.readDetail(listId)
        })
    }

    /** 勾选待办：改目标行的方括号标记，其余行原样保留 */
    public async toggleItem(payload: unknown): Promise<TodoListDetail> {
        if (!isTodoItemToggleRequest(payload)) {
            throw new Error('待办条目参数非法')
        }
        const { listId, index, text, done: isDone } = payload
        await this.assertExisting(listId)
        return this.enqueue(listId, async () => {
            const content = await this.repository.readContent(listId)
            const target = resolveEntry(parseTodoMarkdown(content), index, text)
            await this.write(listId, joinTodoLines(toggleTodoLine(splitTodoLines(content), target.line, isDone)))
            return this.readDetail(listId)
        })
    }

    /** 删除待办：按行剔除目标条目，说明文字与其它条目保持原位 */
    public async deleteItem(payload: unknown): Promise<TodoListDetail> {
        if (!isTodoItemDeleteRequest(payload)) {
            throw new Error('待办条目参数非法')
        }
        const { listId, index, text } = payload
        await this.assertExisting(listId)
        return this.enqueue(listId, async () => {
            const content = await this.repository.readContent(listId)
            const target = resolveEntry(parseTodoMarkdown(content), index, text)
            await this.write(listId, joinTodoLines(removeTodoLine(splitTodoLines(content), target.line)))
            return this.readDetail(listId)
        })
    }

    /** 外部变更通知：文件监听在收到 todo 目录变化后调用，触发面板刷新 */
    public notifyChanged(): void {
        this.changeEmitter.fire()
    }

    /** 判定最近是否由本服务写入：监听器据此跳过自身写入引发的重复刷新 */
    public isRecentlyWritten(): boolean {
        return Date.now() - this.lastWriteAt < WRITE_QUIET_WINDOW_MS
    }

    public dispose(): void {
        this.queue.clear()
        this.changeEmitter.dispose()
    }

    /** 读取清单详情：解析出条目序号、文本与勾选态 */
    private async readDetail(listId: string): Promise<TodoListDetail> {
        const content = await this.repository.readContent(listId)
        const items: TodoItem[] = parseTodoMarkdown(content).map((entry, index) => ({
            index,
            text: entry.text,
            done: entry.done,
        }))
        return {
            list: {
                id: listId,
                name: listId,
                doneCount: items.filter((item) => item.done).length,
                totalCount: items.length,
            },
            items,
        }
    }

    /** 读取清单摘要：文件读取失败时跳过该清单，不让单个坏文件拖垮整份列表 */
    private async readSummary(listId: string): Promise<TodoListSummary | null> {
        try {
            const content = await this.repository.readContent(listId)
            const entries = parseTodoMarkdown(content)
            return {
                id: listId,
                name: listId,
                doneCount: entries.filter((entry) => entry.done).length,
                totalCount: entries.length,
            }
        } catch (cause) {
            logger.warn(
                `待办清单摘要读取失败，已跳过：${listId}（${cause instanceof Error ? cause.message : String(cause)}）`,
            )
            return null
        }
    }

    /** 写盘并记录时间戳：写入成功后由监听器跳过紧随而来的自身变更 */
    private async write(listId: string, content: string): Promise<void> {
        await this.repository.writeContent(listId, content)
        this.lastWriteAt = Date.now()
        logger.info(`待办清单已更新：${listId}`)
    }

    /** 确认清单存在：不存在时给出可读提示，而不是让读取异常直接冒泡 */
    private async assertExisting(listId: string): Promise<void> {
        if (!(await this.repository.isExisting(listId))) {
            throw new Error(`清单不存在：${listId}`)
        }
    }

    /** 生成下一个清单名：取现有「待办 N」的最大值 +1，连续被占用时继续递增 */
    private nextListName(existing: readonly string[]): string {
        const used = new Set(existing)
        let max = 0
        for (const id of existing) {
            const matched = LIST_NAME_PATTERN.exec(id)
            const digits = matched?.[1]
            if (digits !== undefined) {
                max = Math.max(max, Number(digits))
            }
        }
        for (let index = max + 1; index <= max + 100; index += 1) {
            const name = `待办 ${String(index)}`
            if (!used.has(name)) {
                return name
            }
        }
        throw new Error('无法生成新的清单名称，请先整理 todo 目录')
    }

    /** 同清单串行执行：前一次失败不影响后续任务，异常原样上抛给调用方 */
    private enqueue<T>(listId: string, task: () => Promise<T>): Promise<T> {
        const previous = this.queue.get(listId) ?? Promise.resolve()
        const next = previous.then(task, task)
        this.queue.set(
            listId,
            next.then(
                () => undefined,
                () => undefined,
            ),
        )
        return next
    }
}
