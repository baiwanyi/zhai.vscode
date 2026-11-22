/**
 * 关注分组的读取：目标用户所在分组与账号全部分组，走 webClient 的通用 JSON 通道。
 * 复用约定：地址用 new URL 拼基址，查询参数按网页端口径固定；缺 id 的条目在本层丢弃，
 * 前端只消费归一化后的分组数组与 id 列表。
 * 关键约束：uid 只作为查询值，不拼进路径；两个请求共用同一节流队列，实际串行发出；
 * 回包结构异常（data 非数组、lists 缺失）按空结果处理，不阻断弹窗渲染。
 */
import { isWeiboTimelineId } from '@shared/types/weibo'
import type { WeiboUserGroup, WeiboUserGroupsResult } from '@shared/types/weibo'
import type { WeiboJsonQuery, WeiboJsonResponse } from '../transport/httpClient'
import { WEIBO_AJAX_PATHS, WEIBO_WEB_ORIGIN } from '../endpoints'
import { isRecord } from '../guards'
import { requestWeiboJson, toIdString } from '../transport/httpClient'

/** 分组列表的固定查询参数：与网页端一致 */
const USER_GROUP_FILTER = 'system'
const USER_GROUP_HAS_RECOM = 'true'

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
export function readGroup(raw: unknown): WeiboUserGroup | null {
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

/** 取数入参：uid 与凭证，requestJson 供单测注入 */
export interface FetchUserGroupsOptions {
    cookie: string
    uid: string
    timeoutMs?: number
    minIntervalMs?: number
    requestJson?: (query: WeiboJsonQuery) => Promise<WeiboJsonResponse>
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
