/**
 * 我的赞取数：按登录账号 uid 与页码读取点赞过的微博，结果与信息流同形。
 * 复用约定：HTTP、节流与错误分类交给 webClient.requestWeiboJson，单条归一化复用
 * webTimeline.normalizeTimelinePost，端点固定取 weiboEndpoints.likelist。
 * 关键约束：uid 由路由从分组缓存解析后传入，前端不参与拼装；上游没有 max_id 游标，
 * 是否还有下一页只能按总数与固定页长估算；列表存在 list[].mblog 与 statuses 两种层级，
 * 都要兼容，缺 id 的条目由归一化丢弃且不计入去重数。
 */
import type { WeiboLikesResult, WeiboTimelinePost } from '@shared/types/weibo'
import { requestWeiboJson, toIdString } from './webClient'
import { normalizeTimelinePost } from './webTimeline'
import { WEIBO_AJAX_PATHS, WEIBO_WEB_ORIGIN } from './weiboEndpoints'
import type { WeiboJsonQuery, WeiboJsonResponse } from './webClient'

/** 上游每页固定 20 条：总数缺失或无法整除时用它估算是否还有下一页 */
const LIKES_PAGE_SIZE = 20

/** 取数入参：在协议入参之上补齐凭证与可注入的请求实现 */
export interface FetchLikesOptions {
    cookie: string
    /** 登录账号 uid：由路由解析，不接受前端传入 */
    uid: string
    page?: number
    timeoutMs?: number
    minIntervalMs?: number
    /** 请求实现替身：单测不触网 */
    requestJson?: (query: WeiboJsonQuery) => Promise<WeiboJsonResponse>
    /** 时刻来源替身：保证 fetchedAt 可断言 */
    now?: () => Date
}

/** 是否为普通对象：数组与 null 都排除在外 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 夹取页码：非法值回落到第一页，负数与零一律按 1 处理 */
function clampPage(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return 1
    }
    return Math.max(Math.trunc(value), 1)
}

/** 构造地址：uid 与页码都由本层收窄后拼入查询串，统一带 with_total 拿总数 */
export function buildLikesUrl(uid: string, page: number): string {
    const url = new URL(WEIBO_AJAX_PATHS.likelist, WEIBO_WEB_ORIGIN)
    url.searchParams.set('uid', uid)
    url.searchParams.set('page', String(page))
    url.searchParams.set('with_total', 'true')
    return url.toString()
}

/** 从列表条目里取微博对象：mblog 是主形态，data 与条目自身兜底 */
function pickEntryPost(entry: unknown): Record<string, unknown> | null {
    if (!isRecord(entry)) {
        return null
    }
    if (isRecord(entry.mblog)) {
        return entry.mblog
    }
    if (isRecord(entry.data) && toIdString(entry.data.id) !== null) {
        return entry.data
    }
    return toIdString(entry.id) !== null ? entry : null
}

/**
 * 提取原始微博数组：兼容 statuses 与 list 两种层级。
 * 结构异常一律返回空数组，由「已到底」表达，不把整页打成错误。
 */
export function pickLikesPosts(record: Record<string, unknown>): unknown[] {
    const container = isRecord(record.data) ? record.data : record
    if (Array.isArray(container.statuses)) {
        return container.statuses
    }
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

/** 读取点赞总数：缺失或非数字时返回 null，交给「本页是否满页」兜底 */
function pickTotalNumber(record: Record<string, unknown>): number | null {
    const container = isRecord(record.data) ? record.data : record
    const raw = toIdString(container.total_number)
    if (raw === null) {
        return null
    }
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : null
}

/** 判断是否还有下一页：总数可知时按页长估算，未知时以本页是否取满 20 条为准 */
function hasNextPage(page: number, pageCount: number, totalNumber: number | null): boolean {
    if (pageCount === 0) {
        return false
    }
    if (totalNumber === null) {
        return pageCount >= LIKES_PAGE_SIZE
    }
    return page * LIKES_PAGE_SIZE < totalNumber
}

/** 读取一页我的赞：帖子归一化与去重口径与信息流完全一致 */
export async function fetchWeiboLikes(options: FetchLikesOptions): Promise<WeiboLikesResult> {
    const requestJson = options.requestJson ?? requestWeiboJson
    const page = clampPage(options.page)
    const { record } = await requestJson({
        url: buildLikesUrl(options.uid, page),
        cookie: options.cookie,
        timeoutMs: options.timeoutMs,
        minIntervalMs: options.minIntervalMs,
    })
    const posts: WeiboTimelinePost[] = []
    const seen = new Set<string>()
    let droppedDuplicates = 0
    for (const raw of pickLikesPosts(record)) {
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
    const totalNumber = pickTotalNumber(record)
    const now = options.now ?? ((): Date => new Date())
    return {
        posts,
        page,
        hasMore: hasNextPage(page, posts.length, totalNumber),
        totalNumber,
        fetchedAt: now().toISOString(),
        droppedDuplicates,
    }
}
