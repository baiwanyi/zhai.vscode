/**
 * 自定义菜单服务：本地草稿优先，平台仅在首次无草稿时提供初始结构，发布时整棵覆盖平台。
 * 复用约定：Token 走 accountToken.requireWechatToken，接口调用与报文收窄走 openapi，
 * 结构校验走 shared/types/wechat 的 readWechatMenuButtons，内容读写走 db/menuRepository。
 * 关键约束：编辑只写本地草稿，不依赖 Token 与平台；发布前必须校验通过、不做部分提交；
 * 平台成功后才同步本地内容，回读按位置把内容合并回平台按钮，避免两处各存一份结构；
 * 平台没有 id 字段，读取时补齐随机 id 并落盘，保证改名后编辑坐标稳定；
 * 只支持 media_id / article_id / view / miniprogram 四种无回调动作，其它动作只保留名称供用户重选。
 */
import { randomUUID } from 'node:crypto'
import {
    readWechatMenuButtons,
    type WechatMenuButton,
    type WechatMenuResult,
    type WechatMenuSaveRequest,
    type WechatMenuSaveResult,
} from '@shared/types/wechat'
import { requireWechatToken } from './accountToken'
import { deleteWechatMenuJson, readWechatMenuJson, saveWechatMenuJson } from './db/menuRepository'
import { deleteWechatMenu, fetchWechatMenu, saveWechatMenu, type WechatApiResult } from './openapi'
import type { WechatTokenAccessDeps } from './accountToken'
import type Database from 'better-sqlite3'

/**
 * 把本地 id 与内容按位置合并回平台菜单：平台是整棵覆盖，位置即唯一稳定对应。
 * 平台不返回 id 与 content，两者都从本地树补回；无类型的旧动作没有对应内容，不合并。
 */
function mergeMenuContent(remote: WechatMenuButton[], local: WechatMenuButton[]): WechatMenuButton[] {
    return remote.map((button, index) => {
        const saved = local[index]
        const id = saved?.id
        const content = button.type === undefined ? undefined : saved?.content
        const subButton = button.subButton?.map((child, childIndex) => {
            const savedChild = saved?.subButton?.[childIndex]
            const childId = savedChild?.id
            const childContent = child.type === undefined ? undefined : savedChild?.content
            return {
                ...child,
                ...(childId !== undefined && childId.length > 0 ? { id: childId } : {}),
                ...(childContent !== undefined ? { content: childContent } : {}),
            }
        })
        return {
            ...button,
            ...(id !== undefined && id.length > 0 ? { id } : {}),
            ...(content !== undefined ? { content } : {}),
            ...(subButton !== undefined ? { subButton } : {}),
        }
    })
}

/** 递归收集未配置动作的菜单名：新建只填了名字的菜单会落到这里 */
function collectUnconfiguredNames(buttons: WechatMenuButton[]): string[] {
    const names: string[] = []
    for (const button of buttons) {
        if (button.subButton !== undefined) {
            names.push(...collectUnconfiguredNames(button.subButton))
        } else if (button.type === undefined) {
            names.push(button.name)
        }
    }
    return names
}

/** 递归补齐缺失 id：平台结构首次读取与旧本地数据都走这里，随机 id 只在服务端生成一次 */
function ensureMenuIds(buttons: WechatMenuButton[]): WechatMenuButton[] {
    return buttons.map((button) => {
        const base: WechatMenuButton = { ...button, id: button.id?.trim() || randomUUID() }
        return button.subButton === undefined ? base : { ...base, subButton: ensureMenuIds(button.subButton) }
    })
}

/** 读取本地草稿：null 表示从未保存过；解析结果非法时按原始数组兜底，让用户能继续修正 */
function readLocalButtons(db: Database.Database, accountId: string): WechatMenuButton[] | null {
    const json = readWechatMenuJson(db, accountId)
    if (json === null) {
        return null
    }
    try {
        const parsed: unknown = JSON.parse(json)
        if (!Array.isArray(parsed)) {
            return null
        }
        // 旧库可能保存过无 id 的菜单：先剔除脏元素再补齐，非法草稿也原样返回供编辑修正
        const items = parsed.filter((item): item is WechatMenuButton => typeof item === 'object' && item !== null)
        // 空数组是历史上误把「平台未读到」固化成草稿的结果，按无草稿处理，回源平台修正
        if (items.length === 0) {
            return null
        }
        const candidates = ensureMenuIds(items)
        return readWechatMenuButtons(candidates) ?? candidates
    } catch {
        return null
    }
}

export class WechatMenuService {
    public constructor(private readonly deps: WechatTokenAccessDeps, private readonly db: Database.Database) {}

    /**
     * 带 Token 失效重试的平台调用：40001/42001 表示凭证失效，
     * 丢弃缓存后重新取 Token 再试一次；其它错误原样返回。
     */
    private async callWithToken<T>(
        accountId: string,
        run: (accessToken: string) => Promise<WechatApiResult<T>>,
    ): Promise<WechatApiResult<T>> {
        const { accessToken } = await requireWechatToken(this.deps, accountId)
        const first = await run(accessToken)
        if (first.ok || (first.errorCode !== 40001 && first.errorCode !== 42001)) {
            return first
        }
        this.deps.tokens.invalidate(accountId)
        const retried = await requireWechatToken(this.deps, accountId)
        return run(retried.accessToken)
    }

    /** 读取当前菜单：本地草稿优先，只有从未保存过才向平台拉取初始结构 */
    public async get(accountId: string): Promise<WechatMenuResult> {
        const local = readLocalButtons(this.db, accountId)
        if (local !== null) {
            return { hasMenu: local.length > 0, buttons: local }
        }
        const outcome = await this.callWithToken(accountId, (accessToken) => fetchWechatMenu(accessToken))
        if (!outcome.ok) {
            throw new Error(outcome.message)
        }
        const buttons = ensureMenuIds(mergeMenuContent(outcome.data, []))
        // 平台没有 id：首次读取时补齐后落盘为本地草稿，后续编辑都只读写本地
        if (outcome.data.length > 0) {
            saveWechatMenuJson(this.db, accountId, JSON.stringify(buttons), new Date().toISOString())
        }
        return { hasMenu: outcome.data.length > 0, buttons }
    }

    /** 仅写本地草稿：编辑过程不吃 Token、不触碰平台，重启后仍可继续编辑 */
    public saveDraft(accountId: string, buttons: WechatMenuButton[]): void {
        // 空菜单不落草稿：与前端 persistDraft 同口径，避免把空状态固化后不再回源平台
        if (buttons.length === 0) {
            return
        }
        const parsed = readWechatMenuButtons(buttons)
        if (parsed === null) {
            throw new Error('菜单结构不合法，草稿未保存')
        }
        saveWechatMenuJson(this.db, accountId, JSON.stringify(parsed), new Date().toISOString())
    }

    /**
     * 删除整棵菜单：平台会同时删除默认菜单与全部个性化菜单，不可恢复。
     * 关键约束：平台成功后才清本地草稿，避免回读时又显示已删除的菜单。
     */
    public async remove(accountId: string): Promise<{ removed: boolean }> {
        const outcome = await this.callWithToken(accountId, (accessToken) => deleteWechatMenu(accessToken))
        if (!outcome.ok) {
            throw new Error(outcome.message)
        }
        deleteWechatMenuJson(this.db, accountId)
        return { removed: true }
    }

    /**
     * 保存菜单：整棵覆盖。
     * 关键约束：结构非法时指出具体菜单名与缺失项，让用户直接定位要改的那一项；
     * 平台成功后才写本地内容，回读失败时用提交的结构兜底并把内容补回去。
     */
    public async save(request: WechatMenuSaveRequest): Promise<WechatMenuSaveResult> {
        const unconfigured = collectUnconfiguredNames(request.buttons)
        if (unconfigured.length > 0) {
            throw new Error(`以下菜单尚未配置内容，请逐项选择图片 / 已发布图文 / 链接 / 小程序：${unconfigured.join('、')}`)
        }
        const parsed = readWechatMenuButtons(request.buttons)
        const buttons = parsed === null ? null : ensureMenuIds(parsed)
        if (buttons === null) {
            throw new Error(
                '菜单结构不合法：一级最多 3 个、每个最多 5 个二级；名称不能为空且一级不超过 16 字节；' +
                    '下发图片需要选择图片素材，下发图文需要已发布的图文，跳转网页需要 url，跳转小程序需要 appid、页面路径与兜底网页；内容类型需填写完整',
            )
        }
        const saved = await this.callWithToken(request.accountId, (accessToken) => saveWechatMenu(accessToken, buttons))
        if (!saved.ok) {
            throw new Error(saved.message)
        }
        saveWechatMenuJson(this.db, request.accountId, JSON.stringify(buttons), new Date().toISOString())
        // 回读一次：平台对菜单有二次校验，回读能确认真的生效；回读为空或失败时用提交结构兜底
        const applied = await this.callWithToken(request.accountId, (accessToken) => fetchWechatMenu(accessToken))
        const remote = applied.ok && applied.data.length > 0 ? applied.data : buttons
        return { published: true, buttons: ensureMenuIds(mergeMenuContent(remote, buttons)) }
    }
}
