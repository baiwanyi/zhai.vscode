/**
 * 待办服务的单测：覆盖首次初始化、清单新建与删除、条目增改删的落盘结果与冲突处理。
 * 复用约定：虚拟磁盘取 dev/test/stubs/vscode，存储根经 zhai.storage.rootPath 注入，
 * 激活清单用最小 Memento 桩承接，口径与宿主 globalState 一致。
 * 关键约束：断言一律看文件原文——界面展示的条目只是解析结果，能否被编辑器正确读写取决于落盘格式。
 */
import * as path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
    readDeletedPaths,
    readFileContent,
    resetWorkspaceState,
    setConfigValue,
    setDirectory,
    setFileContent,
} from './stubs/vscode'
import type * as vscode from 'vscode'
import { TodoRepository } from '../../src/modules/todo/todoRepository'
import { TodoService } from '../../src/modules/todo/todoService'

const STORAGE_ROOT = 'd:/vault'
const TODO_DIR = path.join(STORAGE_ROOT, 'todo')

/** 清单文件的绝对路径 */
function listPath(name: string): string {
    return path.join(TODO_DIR, `${name}.md`)
}

/** 最小 Memento 桩：只需 keys / get / update，够服务记录激活清单 */
function createMemento(): vscode.Memento {
    const store = new Map<string, unknown>()
    return {
        keys: (): readonly string[] => [...store.keys()],
        get<T>(key: string, defaultValue?: T): T | undefined {
            return store.has(key) ? (store.get(key) as T) : defaultValue
        },
        update: (key: string, value: unknown): Thenable<void> => {
            store.set(key, value)
            return Promise.resolve()
        },
    }
}

let service: TodoService

beforeEach(() => {
    resetWorkspaceState()
    setConfigValue('storage.rootPath', STORAGE_ROOT)
    service = new TodoService(new TodoRepository(), createMemento())
})

describe('清单列表', () => {
    it('目录从未创建时建出默认清单并激活', async () => {
        const snapshot = await service.lists()

        expect(snapshot.lists).toEqual([{ id: '待办 1', name: '待办 1', doneCount: 0, totalCount: 0 }])
        expect(snapshot.activeListId).toBe('待办 1')
        expect(readFileContent(listPath('待办 1'))).toBe('# 待办 1\n')
    })

    it('目录存在但已删空时返回空列表，不再自动重建', async () => {
        setDirectory(TODO_DIR)

        const snapshot = await service.lists()

        expect(snapshot.lists).toEqual([])
        expect(snapshot.activeListId).toBeNull()
        expect(readFileContent(listPath('待办 1'))).toBeUndefined()
    })

    it('按文件名排序并统计完成数', async () => {
        setDirectory(TODO_DIR)
        setFileContent(listPath('待办 1'), '# 待办 1\n\n- [x] 甲\n')
        setFileContent(listPath('待办 2'), '# 待办 2\n\n- [ ] 乙\n- [ ] 丙\n')

        const snapshot = await service.lists()

        expect(snapshot.lists.map((list) => [list.id, list.doneCount, list.totalCount])).toEqual([
            ['待办 1', 1, 1],
            ['待办 2', 0, 2],
        ])
    })
})

describe('新增待办', () => {
    it('按行拆分、去空行与首尾空白后逐条落盘', async () => {
        setDirectory(TODO_DIR)
        setFileContent(listPath('待办 1'), '# 待办 1\n')

        const detail = await service.addItems({ listId: '待办 1', texts: ['写方案', '  整理需求 ', ''] })

        expect(detail.items.map((item) => item.text)).toEqual(['写方案', '整理需求'])
        expect(readFileContent(listPath('待办 1'))).toBe('# 待办 1\n\n- [ ] 写方案\n- [ ] 整理需求\n')
    })

    it('同批次重复文本只保留一条', async () => {
        setDirectory(TODO_DIR)
        setFileContent(listPath('待办 1'), '# 待办 1\n')

        const detail = await service.addItems({ listId: '待办 1', texts: ['同名', '同名'] })

        expect(detail.items).toHaveLength(1)
    })

    it('全空文本直接拒绝，不改动文件', async () => {
        setDirectory(TODO_DIR)
        setFileContent(listPath('待办 1'), '# 待办 1\n')

        await expect(service.addItems({ listId: '待办 1', texts: ['   '] })).rejects.toThrow('待办内容不能为空')
        expect(readFileContent(listPath('待办 1'))).toBe('# 待办 1\n')
    })
})

describe('勾选与删除', () => {
    it('勾选后文件写成 [x]，其余行原样保留', async () => {
        setDirectory(TODO_DIR)
        const content = '# 待办 1\n\n说明：本周重点\n\n- [ ] 甲\n- [ ] 乙\n'
        setFileContent(listPath('待办 1'), content)

        await service.toggleItem({ listId: '待办 1', index: 1, text: '乙', done: true })

        expect(readFileContent(listPath('待办 1'))).toBe('# 待办 1\n\n说明：本周重点\n\n- [ ] 甲\n- [x] 乙\n')
    })

    it('序号漂移但文本唯一命中时仍按文本定位', async () => {
        setDirectory(TODO_DIR)
        setFileContent(listPath('待办 1'), '# 待办 1\n\n- [ ] 甲\n- [ ] 乙\n')

        await service.toggleItem({ listId: '待办 1', index: 9, text: '甲', done: true })

        expect(readFileContent(listPath('待办 1'))).toBe('# 待办 1\n\n- [x] 甲\n- [ ] 乙\n')
    })

    it('文本重复且序号对不上时按冲突拒绝', async () => {
        setDirectory(TODO_DIR)
        setFileContent(listPath('待办 1'), '# 待办 1\n\n- [ ] 同名\n- [ ] 同名\n')

        await expect(service.deleteItem({ listId: '待办 1', index: 9, text: '同名' })).rejects.toThrow(
            '清单已在外部修改',
        )
    })

    it('删除条目后相邻条目与说明文字不动', async () => {
        setDirectory(TODO_DIR)
        setFileContent(listPath('待办 1'), '# 待办 1\n\n说明：本周重点\n\n- [ ] 甲\n- [ ] 乙\n')

        const detail = await service.deleteItem({ listId: '待办 1', index: 0, text: '甲' })

        expect(detail.items.map((item) => item.text)).toEqual(['乙'])
        expect(readFileContent(listPath('待办 1'))).toBe('# 待办 1\n\n说明：本周重点\n\n- [ ] 乙\n')
    })
})

describe('清单新建与删除', () => {
    it('新建清单取现有待办序号的最大值加一', async () => {
        setDirectory(TODO_DIR)
        setFileContent(listPath('待办 1'), '# 待办 1\n')
        setFileContent(listPath('待办 3'), '# 待办 3\n')

        const detail = await service.createList()

        expect(detail.list.id).toBe('待办 4')
        expect(readFileContent(listPath('待办 4'))).toBe('# 待办 4\n')
    })

    it('删除清单走回收站，激活项落到剩余第一份', async () => {
        setDirectory(TODO_DIR)
        setFileContent(listPath('待办 1'), '# 待办 1\n')
        setFileContent(listPath('待办 2'), '# 待办 2\n')
        await service.lists()

        const snapshot = await service.deleteList({ listId: '待办 1' })

        expect(snapshot.lists.map((list) => list.id)).toEqual(['待办 2'])
        expect(snapshot.activeListId).toBe('待办 2')
        expect(readDeletedPaths()).toContain(listPath('待办 1'))
    })

    it('重命名清单同时改写文件名与一级标题', async () => {
        setDirectory(TODO_DIR)
        setFileContent(listPath('待办 1'), '# 待办 1\n\n- [ ] 甲\n')

        const detail = await service.renameList({ listId: '待办 1', name: '本周待办' })

        expect(detail.list.id).toBe('本周待办')
        expect(readFileContent(listPath('本周待办'))).toBe('# 本周待办\n\n- [ ] 甲\n')
        expect(readFileContent(listPath('待办 1'))).toBeUndefined()
    })

    it('重命名撞上已有清单时拒绝，原文件不动', async () => {
        setDirectory(TODO_DIR)
        setFileContent(listPath('待办 1'), '# 待办 1\n')
        setFileContent(listPath('待办 2'), '# 待办 2\n')

        await expect(service.renameList({ listId: '待办 1', name: '待办 2' })).rejects.toThrow('同名清单已存在')
        expect(readFileContent(listPath('待办 1'))).toBe('# 待办 1\n')
    })

    it('重命名用非法名称时在路径构造处被拒绝', async () => {
        setDirectory(TODO_DIR)
        setFileContent(listPath('待办 1'), '# 待办 1\n')

        await expect(service.renameList({ listId: '待办 1', name: '../逃逸' })).rejects.toThrow('清单标识非法')
    })

    it('清单标识含路径分隔符时在路径构造处被拒绝', async () => {
        await expect(service.detail({ listId: '../逃逸' })).rejects.toThrow('清单标识非法')
    })

    it('清单不存在时给出明确提示', async () => {
        setDirectory(TODO_DIR)

        await expect(service.detail({ listId: '缺失' })).rejects.toThrow('清单不存在')
    })
})
