/**
 * 微博转发列表读取：repostTimeline 按页码拉谁转发了这条微博，并归一化转发附言。
 * 复用约定：正文切段复用 webTimeline 的 parsePostSegments，时间与头像走 timeline 的纯函数；
 * 只有页码没有游标，是否还有下一页按「本页条数是否拉满」判定。
 * 关键约束：回包每项是本条转发（自带 retweeted_status），本层只取转发附言，不再展开原文；
 * 纯转发的 text 为空串；计数口径与主贴一致（attitudes_count），原微博赞数单独给出。
 */
import type { WeiboRepostItem, WeiboRepostsResult, WeiboTimelineSegment } from '@shared/types/weibo'
import { WEIBO_AJAX_PATHS, WEIBO_WEB_ORIGIN, WEIBO_WEB_REFERER } from '../endpoints'
import { isRecord, toText } from '../guards'
import { normalizeWeiboImageUrl } from '../timeline/media'
import { readIsLiked } from '../timeline/query'
import { parsePostSegments } from '../timeline/text'
import { parseWeiboCreatedAt } from '../timeline/time'
import { WEIBO_WEB_USER_AGENT, WeiboWebError } from '../transport/httpClient'

/** 单页默认条数：与网页端一致 */
export const WEIBO_REPOSTS_DEFAULT_COUNT = 10

/** 单页上限：转发列表一次拉太多没有意义 */
const MAX_REPOST_COUNT = 50

/** 请求超时 */
const REQUEST_TIMEOUT_MS = 15_000

/** 转发列表请求参数 */
export interface FetchRepostsOptions {
    cookie: string
    /** 微博数字 id */
    id: string
    /** 页码：从 1 开始 */
    page?: number
    count?: number
    timeoutMs?: number
}

/** 剥掉来源字段里的 HTML 外壳：「来自 <a>iPhone</a>」只留文字 */
function stripTags(value: string): string {
    return value.replace(/<[^>]*>/g, '').trim()
}

/** 计数：数字与数字字符串都接受，缺失或非数值按 0，负数按 0（与时间线、评论同一口径） */
function toCount(value: unknown): number {
    const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
    return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0
}

/**
 * 点赞数：转发项与主贴同形，按字段优先级取第一个存在的值；一个都没有时回 null。
 * 关键约束：只认第一个命中的字段——0 是合法计数，不能因为它为假值就继续往后找；
 * null 与 0 必须区分：前者表示上游没下发，界面不显示数字，后者是真实的零赞。
 */
function readLikeCount(raw: Record<string, unknown>): number | null {
    for (const key of ['attitudes_count', 'attitude_count', 'like_counts']) {
        const value = raw[key]
        if (typeof value === 'number' || typeof value === 'string') {
            return toCount(value)
        }
    }
    return null
}

/** 夹取页码：非法值回落第一页 */
function clampPage(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return 1
    }
    return Math.max(Math.trunc(value), 1)
}

/** 夹取条数：非法值回落默认，超出上限按上限 */
export function clampRepostCount(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return WEIBO_REPOSTS_DEFAULT_COUNT
    }
    return Math.min(Math.max(Math.trunc(value), 1), MAX_REPOST_COUNT)
}

/** 构造转发列表地址：只有 id / page / moduleID / count 四个参数 */
export function buildRepostsUrl(options: FetchRepostsOptions): string {
    const url = new URL(WEIBO_AJAX_PATHS.repostTimeline, WEIBO_WEB_ORIGIN)
    url.searchParams.set('id', options.id)
    url.searchParams.set('page', String(clampPage(options.page)))
    url.searchParams.set('moduleID', 'feed')
    url.searchParams.set('count', String(clampRepostCount(options.count)))
    return url.toString()
}

/**
 * 归一化单条转发：id 缺失直接丢弃，正文只取转发附言。
 * 命名带 Web 前缀，与时间线、评论的归一化函数保持同一命名口径。
 */
export function normalizeWebRepost(raw: unknown): WeiboRepostItem | null {
    if (!isRecord(raw)) {
        return null
    }
    const id = toText(raw.idstr) || toText(raw.id)
    if (id.length === 0) {
        return null
    }
    const user = isRecord(raw.user) ? raw.user : {}
    const html = toText(raw.text)
    const segments: WeiboTimelineSegment[] = html.length > 0 ? parsePostSegments(html) : []
    // 纯文本口径：链接只留文字、表情还原成 [名称]，与评论列表一致
    const text = segments
        .map((segment) => {
            if (segment.type === 'text' || segment.type === 'link') {
                return segment.text
            }
            return segment.name.length > 0 ? `[${segment.name}]` : ''
        })
        .join('')
    const createdAtRaw = toText(raw.created_at)
    const avatar = toText(user.avatar_large) || toText(user.profile_image_url)
    const retweeted = isRecord(raw.retweeted_status) ? raw.retweeted_status : null
    return {
        id,
        mblogid: toText(raw.mblogid),
        text,
        segments,
        createdAt: parseWeiboCreatedAt(createdAtRaw),
        createdAtRaw,
        author: {
            id: toText(user.id),
            name: toText(user.screen_name),
            avatarUrl: normalizeWeiboImageUrl(avatar) ?? '',
            isVerified: user.verified === true,
            // 转发列表不提供关注入口：这里恒为未关注，避免前端据此显示关注按钮
            isFollowing: false,
        },
        // 点赞口径与主贴一致：计数取 attitudes_count，点赞态取 attitudes_status
        likes: readLikeCount(raw),
        isLiked: readIsLiked(raw),
        // 原微博的赞数是另一份数据：转发列表里条目自身几乎都是 0，展示它才有参考价值
        originalLikes: retweeted === null ? null : readLikeCount(retweeted),
        source: stripTags(toText(raw.source)),
    }
}

/** 拉取某条微博的转发列表：返回本页转发与是否还有下一页 */
export async function fetchPostReposts(options: FetchRepostsOptions): Promise<WeiboRepostsResult> {
    const page = clampPage(options.page)
    const count = clampRepostCount(options.count)
    let response: Response
    try {
        response = await fetch(buildRepostsUrl({ ...options, page, count }), {
            method: 'GET',
            headers: {
                Cookie: options.cookie,
                Referer: WEIBO_WEB_REFERER,
                'User-Agent': WEIBO_WEB_USER_AGENT,
                Accept: 'application/json, text/plain, */*',
                'X-Requested-With': 'XMLHttpRequest',
            },
            signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
        })
    } catch {
        throw new WeiboWebError('network', '转发列表请求失败：请检查网络或代理设置')
    }

    if (response.status === 401 || response.status === 403) {
        throw new WeiboWebError('unauthorized', '微博登录态已失效：请重新登录并更新 Cookie', response.status)
    }
    if (response.status === 418 || response.status === 429) {
        throw new WeiboWebError('rate-limited', '转发列表读取过于频繁：请稍后再试', response.status)
    }
    if (!response.ok) {
        throw new WeiboWebError('upstream', `转发列表请求失败：HTTP ${String(response.status)}`, response.status)
    }

    const trimmed = (await response.text()).trim()
    if (trimmed.startsWith('<')) {
        throw new WeiboWebError('unauthorized', '微博登录态已失效：请重新登录并更新 Cookie', response.status)
    }
    let parsed: unknown
    try {
        parsed = JSON.parse(trimmed)
    } catch {
        throw new WeiboWebError('invalid-payload', '转发列表返回无法解析：接口可能已改版', response.status)
    }
    if (!isRecord(parsed)) {
        throw new WeiboWebError('invalid-payload', '转发列表返回结构异常', response.status)
    }
    const ok = parsed.ok
    if (typeof ok === 'number' && ok <= 0) {
        const message = typeof parsed.msg === 'string' ? parsed.msg : '未知错误'
        throw new WeiboWebError('upstream', `转发列表读取失败：${message}`, response.status)
    }

    const list = Array.isArray(parsed.data) ? parsed.data : []
    const reposts: WeiboRepostItem[] = []
    for (const item of list) {
        const repost = normalizeWebRepost(item)
        if (repost !== null) {
            reposts.push(repost)
        }
    }
    return { reposts, page, hasMore: reposts.length >= count }
}
