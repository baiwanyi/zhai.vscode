/**
 * 关注关系：关注分组的读取 / 新建 / 归组与备注名设置。
 * 复用约定：读走 webClient 的通用 JSON 通道（同一套请求头、节流与错误分类），
 * 写走 webInteraction 的写接口公共头（Cookie / Origin / XSRF），并统一按 form 提交；
 * 缺 id 的条目由本层丢弃，前端只消费归一化后的分组与备注。
 * 关键约束：uid、分组 id 一律是数字串，只作为 form 值提交，不拼进路径；
 * 分组名 1-8 字、备注 0-15 字由协议层收窄，本层不再放宽；
 * origin_list_ids 按网页端实测形态拼（原始分组 + 0 + 原始分组，0 表示默认分组），
 * 空分组只提交 0；备注更新回包是被改动的 user 对象（没有 ok 包装），
 * 只有明确 ok <= 0 才算失败，备注以上游回包的 remark 为准。
 */
import { isWeiboTimelineId } from '@shared/types/weibo'
import type {
    WeiboGroupCreateResult,
    WeiboGroupSaveResult,
    WeiboUserGroup,
    WeiboUserGroupsResult,
    WeiboUserRemarkResult,
} from '@shared/types/weibo'
import { requestWeiboJson, toIdString, WeiboWebError, WEIBO_WEB_USER_AGENT } from './webClient'
import { buildWriteHeaders } from './webInteraction'
import { WEIBO_AJAX_PATHS, WEIBO_WEB_ORIGIN, WEIBO_WEB_REFERER } from './weiboEndpoints'
import type { WeiboJsonQuery, WeiboJsonResponse } from './webClient'

/** 写操作超时：与其它写接口一致，失败让用户立刻重试 */
const REQUEST_TIMEOUT_MS = 15_000

/** 默认分组 id：未归入任何自定义分组时上游用 0 表示 */
const DEFAULT_GROUP_ID = '0'

/** 分组列表的固定查询参数：与网页端一致 */
const USER_GROUP_FILTER = 'system'
const USER_GROUP_HAS_RECOM = 'true'

/** 是否为普通对象：数组与 null 都排除在外 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 目标用户所在分组的地址：getGroupList 只认 uid */
export function buildUserGroupOfUrl(uid: string): string {
    const url = new URL(WEIBO_AJAX_PATHS.userGroupOf, WEIBO_WEB_ORIGIN)
    url.searchParams.set('uid', uid)
    return url.toString()
}

/** 账号全部分组的地址：filterType 与 hasRecom 与网页端一致 */
export function buildUserGroupListUrl(uid: string): string {
    const url = new URL(WEIBO_AJAX_PATHS.userGroupList, WEIBO_WEB_ORIGIN)
    url.searchParams.set('target_uid', uid)
    url.searchParams.set('filterType', USER_GROUP_FILTER)
    url.searchParams.set('hasRecom', USER_GROUP_HAS_RECOM)
    return url.toString()
}

/** 归一化单个分组：缺 id 或名称为空返回 null，成员数缺失按 0 */
function readGroup(raw: unknown): WeiboUserGroup | null {
    if (!isRecord(raw)) {
        return null
    }
    const id = toIdString(raw.id) ?? toIdString(raw.idstr) ?? ''
    const name = typeof raw.name === 'string' ? raw.name.trim() : ''
    if (!isWeiboTimelineId(id) || name.length === 0) {
        return null
    }
    return {
        id,
        name,
        memberCount: typeof raw.member_count === 'number' ? Math.trunc(raw.member_count) : 0,
        isPublic: raw.mode === 'public',
    }
}

/** 读当前用户所在分组：data 直接是数组，缺 id 的条目丢弃 */
function readMemberGroupIds(record: Record<string, unknown>): string[] {
    if (!Array.isArray(record.data)) {
        return []
    }
    const ids: string[] = []
    for (const entry of record.data) {
        if (!isRecord(entry)) {
            continue
        }
        const id = toIdString(entry.id) ?? toIdString(entry.idstr) ?? ''
        if (isWeiboTimelineId(id)) {
            ids.push(id)
        }
    }
    return ids
}

/** 读全部分组：data.lists 为分组数组，结构异常按空列表处理 */
function readGroups(record: Record<string, unknown>): WeiboUserGroup[] {
    const container = isRecord(record.data) ? record.data : record
    if (!Array.isArray(container.lists)) {
        return []
    }
    const groups: WeiboUserGroup[] = []
    for (const entry of container.lists) {
        const group = readGroup(entry)
        if (group !== null) {
            groups.push(group)
        }
    }
    return groups
}

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

/** 取数入参：uid 与凭证，requestJson 供单测注入 */
export interface FetchUserGroupsOptions {
    cookie: string
    uid: string
    timeoutMs?: number
    minIntervalMs?: number
    requestJson?: (query: WeiboJsonQuery) => Promise<WeiboJsonResponse>
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

/**
 * 读取分组：当前用户所在分组与账号全部分组并行取回。
 * 关键约束：两个请求都经同一节流队列，实际是串行发出，但节省一次前端等待与状态切换。
 */
export async function fetchUserGroups(options: FetchUserGroupsOptions): Promise<WeiboUserGroupsResult> {
    const requestJson = options.requestJson ?? requestWeiboJson
    const [ofQuery, listQuery] = await Promise.all([
        requestJson({
            url: buildUserGroupOfUrl(options.uid),
            cookie: options.cookie,
            timeoutMs: options.timeoutMs,
            minIntervalMs: options.minIntervalMs,
        }),
        requestJson({
            url: buildUserGroupListUrl(options.uid),
            cookie: options.cookie,
            timeoutMs: options.timeoutMs,
            minIntervalMs: options.minIntervalMs,
        }),
    ])
    return { groupIds: readMemberGroupIds(ofQuery.record), groups: readGroups(listQuery.record) }
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
