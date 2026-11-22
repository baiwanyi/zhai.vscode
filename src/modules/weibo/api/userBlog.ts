/**
 * 他人主页取数：profile/info 取资料（uid 或不含 uid 的昵称），mymblog 取该用户的微博列表。
 * 复用约定：请求走 webClient 的通用 JSON 通道（同一套请求头、节流与错误分类）；
 * 资料归一化复用 webProfile.normalizeWeiboUserInfo，帖子归一化复用 webTimeline.normalizeTimelinePost，
 * 与信息流 / 我的赞保持同形。
 * 关键约束：mymblog 只有页码分页（没有 max_id 游标），是否还有下一页按上游 total 估算，
 * 缺失时以本页是否满 20 条为准；昵称查询必须先经资料回包换到 uid，拿不到 uid 时明确报错，
 * 不拼空 uid 去撞上游；缺 id 的条目由归一化丢弃且不计入去重数。
 */
import type { WeiboUserBlogResult, WeiboTimelinePost } from '@shared/types/weibo'
import { buildUserInfoUrl, normalizeWeiboUserInfo } from './profile'
import type { WeiboJsonQuery, WeiboJsonResponse } from '../transport/httpClient'
import type { WeiboUserLookup } from './profile'
import { WEIBO_AJAX_PATHS, WEIBO_WEB_ORIGIN } from '../endpoints'
import { isRecord } from '../guards'
import { normalizeTimelinePost } from '../timeline/query'
import { WeiboWebError, requestWeiboJson, toIdString } from '../transport/httpClient'

/** 上游每页固定 20 条：总数缺失或无法整除时用它估算是否还有下一页 */
const USER_BLOG_PAGE_SIZE = 20

/** 主页列表的 feature 参数：与网页端「微博」标签一致 */
const USER_BLOG_FEATURE = '0'

/** 取数入参：在协议入参之上补齐凭证与可注入的请求实现 */
export interface FetchUserBlogOptions extends WeiboUserLookup {
    cookie: string
    page?: number
    timeoutMs?: number
    minIntervalMs?: number
    /** 请求实现替身：单测不触网 */
    requestJson?: (query: WeiboJsonQuery) => Promise<WeiboJsonResponse>
    /** 时刻来源替身：保证 fetchedAt 可断言 */
    now?: () => Date
}

/** 夹取页码：非法值回落到第一页，负数与零一律按 1 处理 */
function clampPage(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return 1
    }
    return Math.max(Math.trunc(value), 1)
}

/** 构造主页微博列表地址：uid、页码与 feature 都由本层收窄后拼入查询串 */
export function buildUserBlogUrl(uid: string, page: number): string {
    const url = new URL(WEIBO_AJAX_PATHS.userBlog, WEIBO_WEB_ORIGIN)
    url.searchParams.set('uid', uid)
    url.searchParams.set('page', String(page))
    url.searchParams.set('feature', USER_BLOG_FEATURE)
    return url.toString()
}

/** 从列表条目里取微博对象：mblog 是包裹形态，条目自身即微博对象时直接使用 */
function pickEntryPost(entry: unknown): Record<string, unknown> | null {
    if (!isRecord(entry)) {
        return null
    }
    if (isRecord(entry.mblog)) {
        return entry.mblog
    }
    return toIdString(entry.id) !== null ? entry : null
}

/** 提取原始微博数组：mymblog 把微博直接放在 data.list，结构异常按空列表处理 */
function pickUserBlogPosts(record: Record<string, unknown>): unknown[] {
    const container = isRecord(record.data) ? record.data : record
    if (!Array.isArray(container.list)) {
        return []
    }
    const posts: unknown[] = []
    for (const entry of container.list) {
        const post = pickEntryPost(entry)
        if (post !== null) {
            posts.push(post)
        }
    }
    return posts
}

/** 读取微博总数：缺失或非数字时返回 null，交给「本页是否满页」兜底 */
function pickTotal(record: Record<string, unknown>): number | null {
    const container = isRecord(record.data) ? record.data : record
    const raw = toIdString(container.total)
    if (raw === null) {
        return null
    }
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : null
}

/** 判断是否还有下一页：总数可知时按页长估算，未知时以本页是否取满 20 条为准 */
function hasNextPage(page: number, pageCount: number, total: number | null): boolean {
    if (pageCount === 0) {
        return false
    }
    if (total === null) {
        return pageCount >= USER_BLOG_PAGE_SIZE
    }
    return page * USER_BLOG_PAGE_SIZE < total
}

/**
 * 读取一页他人主页：先查资料拿 uid，再按 uid 与页码取微博列表。
 * 关键约束：资料查询失败或结构不可用时整条报错，不回退「只给列表不给资料」的半成品页面。
 */
export async function fetchWeiboUserBlog(options: FetchUserBlogOptions): Promise<WeiboUserBlogResult> {
    const requestJson = options.requestJson ?? requestWeiboJson
    const page = clampPage(options.page)
    const infoQuery = await requestJson({
        url: buildUserInfoUrl({ uid: options.uid, screenName: options.screenName }),
        cookie: options.cookie,
        timeoutMs: options.timeoutMs,
        minIntervalMs: options.minIntervalMs,
    })
    const user = normalizeWeiboUserInfo(infoQuery.record)
    if (user === null) {
        throw new WeiboWebError('invalid-payload', '微博返回结构异常：没有可用的用户资料')
    }
    const blogQuery = await requestJson({
        url: buildUserBlogUrl(user.id, page),
        cookie: options.cookie,
        timeoutMs: options.timeoutMs,
        minIntervalMs: options.minIntervalMs,
    })
    const posts: WeiboTimelinePost[] = []
    const seen = new Set<string>()
    let droppedDuplicates = 0
    for (const raw of pickUserBlogPosts(blogQuery.record)) {
        const post = normalizeTimelinePost(raw)
        if (post === null) {
            continue
        }
        if (seen.has(post.id)) {
            droppedDuplicates += 1
            continue
        }
        seen.add(post.id)
        posts.push(post)
    }
    const total = pickTotal(blogQuery.record)
    const now = options.now ?? ((): Date => new Date())
    return {
        user,
        posts,
        page,
        hasMore: hasNextPage(page, posts.length, total),
        total,
        fetchedAt: now().toISOString(),
        droppedDuplicates,
    }
}
