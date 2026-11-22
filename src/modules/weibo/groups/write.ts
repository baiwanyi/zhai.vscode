/**
 * 关注分组的写入：新建分组、把用户归组与设置备注名，统一按 form 提交。
 * 复用约定：写接口公共头（Cookie / Origin / XSRF）取 webInteraction，分组归一化复用同域的 read 模块。
 * 关键约束：uid、分组 id 一律是数字串，只作为 form 值提交，不拼进路径；
 * origin_list_ids 按网页端实测形态拼（原始分组 + 0 + 原始分组，0 表示默认分组），空分组只提交 0；
 * 备注更新回包是被改动的 user 对象（没有 ok 包装），只有明确 ok <= 0 才算失败；写操作不重试。
 */
import type { WeiboGroupCreateResult, WeiboGroupSaveResult, WeiboUserRemarkResult } from '@shared/types/weibo'
import { readGroup } from './read'
import { buildWriteHeaders } from '../api/write/interaction'
import { WEIBO_AJAX_PATHS, WEIBO_WEB_ORIGIN, WEIBO_WEB_REFERER } from '../endpoints'
import { isRecord } from '../guards'
import { WEIBO_WEB_USER_AGENT, WeiboWebError } from '../transport/httpClient'

/** 写操作超时：与其它写接口一致，失败让用户立刻重试 */
const REQUEST_TIMEOUT_MS = 15_000

/** 默认分组 id：未归入任何自定义分组时上游用 0 表示 */
const DEFAULT_GROUP_ID = '0'

/**
 * 拼 list_ids：没有选中任何分组时提交 0（上游据此把用户移出自定义分组）。
 * 关键约束：只拼已收窄的数字串，调用方不再二次清洗。
 */
export function buildGroupListIds(listIds: string[]): string {
    return listIds.length === 0 ? DEFAULT_GROUP_ID : listIds.join(',')
}

/**
 * 拼 origin_list_ids：按网页端实测形态「原始分组 + 0 + 原始分组」复刻，
 * 中间与末尾的 0 / 重复项是上游要求的原始状态快照，不要「优化」成去重集合。
 */
export function buildGroupOriginIds(originListIds: string[]): string {
    if (originListIds.length === 0) {
        return DEFAULT_GROUP_ID
    }
    return [...originListIds, DEFAULT_GROUP_ID, ...originListIds].join(',')
}

/** 新建分组入参 */
export interface CreateUserGroupOptions {
    cookie: string
    name: string
    isPublic: boolean
    timeoutMs?: number
}

/** 保存分组入参 */
export interface SaveUserGroupsOptions {
    cookie: string
    uid: string
    listIds: string[]
    originListIds: string[]
    timeoutMs?: number
}

/** 设置备注入参 */
export interface SetUserRemarkOptions {
    cookie: string
    uid: string
    remark: string
    timeoutMs?: number
}

/** 成功判定：ok > 0 或 result: true，二者取其一 */
function isWriteOk(record: Record<string, unknown>): boolean {
    return (typeof record.ok === 'number' && record.ok > 0) || record.result === true
}

/** 从失败回包取提示：上游 msg 里出现「频繁 / 过快」归为限流 */
function toWriteError(record: Record<string, unknown>, action: string, status: number): WeiboWebError {
    const message = typeof record.msg === 'string' ? record.msg : '未知错误'
    const code = message.includes('频繁') || message.includes('过快') ? 'rate-limited' : 'upstream'
    return new WeiboWebError(code, `${action}失败：${message}`, status)
}

/** 写接口通用提交：form 编码、统一状态码分类，回包按对象返回 */
async function postWeiboForm(
    cookie: string,
    path: string,
    form: URLSearchParams,
    timeoutMs: number | undefined,
): Promise<Record<string, unknown>> {
    const headers = buildWriteHeaders(cookie)
    headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8'
    headers.Referer = WEIBO_WEB_REFERER
    headers['User-Agent'] = WEIBO_WEB_USER_AGENT

    let response: Response
    try {
        response = await fetch(`${WEIBO_WEB_ORIGIN}${path}`, {
            method: 'POST',
            headers,
            body: form.toString(),
            signal: AbortSignal.timeout(timeoutMs ?? REQUEST_TIMEOUT_MS),
        })
    } catch {
        throw new WeiboWebError('network', '请求失败：请检查网络或代理设置')
    }
    if (response.status === 401 || response.status === 403) {
        throw new WeiboWebError('unauthorized', '微博登录态已失效：请重新登录并更新 Cookie', response.status)
    }
    if (response.status === 418 || response.status === 429) {
        throw new WeiboWebError('rate-limited', '操作过于频繁：请稍后再试', response.status)
    }
    if (!response.ok) {
        throw new WeiboWebError('upstream', `请求失败：HTTP ${String(response.status)}`, response.status)
    }
    const text = (await response.text()).trim()
    if (text.startsWith('<')) {
        throw new WeiboWebError('unauthorized', '微博登录态已失效：请重新登录并更新 Cookie', response.status)
    }
    let parsed: unknown
    try {
        parsed = JSON.parse(text)
    } catch {
        throw new WeiboWebError('invalid-payload', '微博返回无法解析：接口可能已改版', response.status)
    }
    if (!isRecord(parsed)) {
        throw new WeiboWebError('invalid-payload', '微博返回结构异常', response.status)
    }
    return parsed
}

/**
 * 新建分组：form 只提交名称，选择公开时另带 isOpen=true。
 * 关键约束：回包 data 就是新分组，缺 id 视为失败，避免前端插入一个空分组。
 */
export async function createUserGroup(options: CreateUserGroupOptions): Promise<WeiboGroupCreateResult> {
    const form = new URLSearchParams()
    form.set('name', options.name.trim())
    if (options.isPublic) {
        form.set('isOpen', 'true')
    }
    const record = await postWeiboForm(options.cookie, WEIBO_AJAX_PATHS.userGroupCreate, form, options.timeoutMs)
    if (!isWriteOk(record)) {
        throw toWriteError(record, '新建分组', 200)
    }
    const group = readGroup(record.data)
    if (group === null) {
        throw new WeiboWebError('invalid-payload', '新建分组失败：回包没有可用的分组 id', 200)
    }
    return { group }
}

/**
 * 保存分组：把用户放进 listIds 这批分组，originListIds 为请求前的分组。
 * 关键约束：回包 data.result 必须为 true，否则上游已拒绝这次归组。
 */
export async function saveUserGroups(options: SaveUserGroupsOptions): Promise<WeiboGroupSaveResult> {
    const form = new URLSearchParams()
    form.set('uids', options.uid)
    form.set('list_ids', buildGroupListIds(options.listIds))
    form.set('origin_list_ids', buildGroupOriginIds(options.originListIds))
    const record = await postWeiboForm(options.cookie, WEIBO_AJAX_PATHS.userGroupSet, form, options.timeoutMs)
    const data = isRecord(record.data) ? record.data : {}
    if (!isWriteOk(record) || data.result !== true) {
        throw toWriteError(record, '保存分组', 200)
    }
    return { saved: true }
}

/**
 * 设置备注：form 提交 uid 与 remark，空串即清除。
 * 关键约束：回包是被改动的 user 对象，没有 ok 包装——只有明确 ok <= 0 才算失败；
 * 备注以上游回包的 remark 为准，缺失时回传入参，避免前端与真实值不一致。
 */
export async function setUserRemark(options: SetUserRemarkOptions): Promise<WeiboUserRemarkResult> {
    const remark = options.remark.trim()
    const form = new URLSearchParams()
    form.set('uid', options.uid)
    form.set('remark', remark)
    const record = await postWeiboForm(options.cookie, WEIBO_AJAX_PATHS.userRemark, form, options.timeoutMs)
    if (typeof record.ok === 'number' && record.ok <= 0) {
        throw toWriteError(record, '设置备注', 200)
    }
    const saved = typeof record.remark === 'string' ? record.remark.trim() : remark
    return { remark: saved }
}
