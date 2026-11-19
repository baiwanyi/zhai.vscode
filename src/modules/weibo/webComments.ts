/**
 * 微博评论读取：网页版 buildComments 接口，只读。
 * 复用约定：与时间线共用登录 Cookie 与错误分类；正文切段与表情解析复用 webTimeline 的 parsePostSegments；
 * 头像与表情地址同样过图床白名单，前端仍走 weibo/image 代理加载。
 * 关键约束：分页游标只取响应顶层 max_id，不能自造；首页带 is_reload=1，翻页改带 max_id；
 * uid 可选（缺省由服务端按 Cookie 识别）；文本与计数缺失一律按空串 / 0 兜底，不阻断整页。
 */
import type { WeiboCommentItem, WeiboCommentsResult, WeiboTimelineSegment } from '@shared/types/weibo'
import { WEIBO_WEB_ORIGIN, WEIBO_WEB_USER_AGENT, WeiboWebError } from './webClient'
import { normalizeWeiboImageUrl, parsePostSegments, parseWeiboCreatedAt } from './webTimeline'

/** 评论接口路径 */
export const WEIBO_COMMENTS_PATH = '/ajax/statuses/buildComments'

/** 单页默认条数：与网页端一致的 10 条 */
export const WEIBO_COMMENTS_DEFAULT_COUNT = 10

/** 单页上限：一次拉太多会明显拖慢展开评论的体感 */
const MAX_COMMENT_COUNT = 30

/** 请求超时 */
const REQUEST_TIMEOUT_MS = 15_000

/** 官网 Referer */
const WEIBO_REFERER = 'https://weibo.com/'

/** 评论请求参数 */
export interface FetchCommentsOptions {
    cookie: string
    /** 微博数字 id */
    id: string
    /** 下一页游标：缺省拉第一页 */
    maxId?: string | null
    count?: number
    /** 当前登录用户 uid：缺省由服务端按 Cookie 识别 */
    uid?: string | null
    timeoutMs?: number
}

/** 是否为普通对象 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 仅接受字符串与数字并转文本 */
function toText(value: unknown): string {
    return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

/** 计数取值：非负整数以外一律按 0 */
function toCount(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0
}

/** 夹取条数：非法值回落默认，超出上限按上限 */
export function clampCommentCount(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return WEIBO_COMMENTS_DEFAULT_COUNT
    }
    return Math.min(Math.max(Math.trunc(value), 1), MAX_COMMENT_COUNT)
}

/** 构造评论请求地址：首页带 is_reload=1，翻页改带 max_id */
export function buildCommentsUrl(options: FetchCommentsOptions): string {
    const url = new URL(WEIBO_COMMENTS_PATH, WEIBO_WEB_ORIGIN)
    const maxId = options.maxId?.trim() ?? ''
    if (maxId.length === 0) {
        url.searchParams.set('is_reload', '1')
    }
    url.searchParams.set('id', options.id)
    url.searchParams.set('is_show_bulletin', '3')
    url.searchParams.set('is_mix', '0')
    url.searchParams.set('count', String(clampCommentCount(options.count)))
    const uid = options.uid?.trim() ?? ''
    if (uid.length > 0) {
        url.searchParams.set('uid', uid)
    }
    url.searchParams.set('fetch_level', '0')
    url.searchParams.set('locale', 'zh-CN')
    if (maxId.length > 0) {
        url.searchParams.set('max_id', maxId)
    }
    return url.toString()
}

/** 无 HTML 时的单段文本 */
function buildPlainSegments(text: string): WeiboTimelineSegment[] {
    return text.length > 0 ? [{ type: 'text', text }] : []
}

/**
 * 归一化单条评论：id 缺失直接丢弃。
 * 命名带 Web 前缀，避免与开放平台版的 normalizeComment 在模块统一导出时撞名。
 */
export function normalizeWebComment(raw: unknown): WeiboCommentItem | null {
    if (!isRecord(raw)) {
        return null
    }
    const id = toText(raw.idstr) || toText(raw.id)
    if (id.length === 0) {
        return null
    }
    const user = isRecord(raw.user) ? raw.user : {}
    const html = toText(raw.text)
    const segments = html.length > 0 ? parsePostSegments(html) : buildPlainSegments(toText(raw.text_raw))
    // 纯文本口径：表情以 [名称] 保留，便于复制与检索
    const text = segments
        .map((segment) => (segment.type === 'text' ? segment.text : segment.name.length > 0 ? `[${segment.name}]` : ''))
        .join('')
    const createdAtRaw = toText(raw.created_at)
    const avatar = toText(user.avatar_large) || toText(user.profile_image_url)
    return {
        id,
        text,
        segments,
        createdAt: parseWeiboCreatedAt(createdAtRaw),
        createdAtRaw,
        author: {
            id: toText(user.id),
            name: toText(user.screen_name),
            avatarUrl: normalizeWeiboImageUrl(avatar) ?? '',
        },
        likes: toCount(raw.like_counts),
    }
}

/** 读取游标：兼容数字与字符串，0 视为没有更多 */
function readCursor(value: unknown): string | null {
    const text =
        typeof value === 'number' && Number.isFinite(value)
            ? value.toLocaleString('fullwide', { useGrouping: false })
            : toText(value).trim()
    return text.length > 0 && text !== '0' ? text : null
}

/** 拉取某条微博的评论：返回本页评论与下一页游标 */
export async function fetchPostComments(options: FetchCommentsOptions): Promise<WeiboCommentsResult> {
    let response: Response
    try {
        response = await fetch(buildCommentsUrl(options), {
            method: 'GET',
            headers: {
                Cookie: options.cookie,
                Referer: WEIBO_REFERER,
                'User-Agent': WEIBO_WEB_USER_AGENT,
                Accept: 'application/json, text/plain, */*',
                'X-Requested-With': 'XMLHttpRequest',
            },
            signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
        })
    } catch {
        throw new WeiboWebError('network', '评论请求失败：请检查网络或代理设置')
    }

    if (response.status === 401 || response.status === 403) {
        throw new WeiboWebError('unauthorized', '微博登录态已失效：请重新登录并更新 Cookie', response.status)
    }
    if (response.status === 418 || response.status === 429) {
        throw new WeiboWebError('rate-limited', '评论读取过于频繁：请稍后再试', response.status)
    }
    if (!response.ok) {
        throw new WeiboWebError('upstream', `评论请求失败：HTTP ${String(response.status)}`, response.status)
    }

    const body = await response.text()
    const trimmed = body.trim()
    if (trimmed.startsWith('<')) {
        throw new WeiboWebError('unauthorized', '微博登录态已失效：请重新登录并更新 Cookie', response.status)
    }
    let parsed: unknown
    try {
        parsed = JSON.parse(trimmed)
    } catch {
        throw new WeiboWebError('invalid-payload', '评论返回无法解析：接口可能已改版', response.status)
    }
    if (!isRecord(parsed)) {
        throw new WeiboWebError('invalid-payload', '评论返回结构异常', response.status)
    }
    const ok = parsed.ok
    if (typeof ok === 'number' && ok <= 0) {
        const message = typeof parsed.msg === 'string' ? parsed.msg : '未知错误'
        throw new WeiboWebError('upstream', `评论读取失败：${message}`, response.status)
    }

    const list = Array.isArray(parsed.data) ? parsed.data : []
    const comments: WeiboCommentItem[] = []
    for (const item of list) {
        const comment = normalizeWebComment(item)
        if (comment !== null) {
            comments.push(comment)
        }
    }
    const maxId = readCursor(parsed.max_id)
    return {
        comments,
        totalNumber: toCount(parsed.total_number),
        maxId,
        hasMore: maxId !== null && comments.length > 0,
    }
}
