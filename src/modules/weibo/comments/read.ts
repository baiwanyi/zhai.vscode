/**
 * 微博评论读取：网页版 buildComments 拉一级评论与子回复，并把正文、作者与游标归一化。
 * 复用约定：正文切段与表情解析复用 webTimeline 的 parsePostSegments，时间与头像走 timeline 的纯函数；
 * 一级评论与子评论只差地址参数，请求与解析共用同一份实现。
 * 关键约束：分页游标只取响应顶层 max_id，不能自造；首页带 is_reload=1，翻页改带 max_id；
 * 文本与计数缺失一律按空串 / 0 兜底，不阻断整页；子评论预览最多保留 3 条。
 */
import type {
    WeiboCommentAuthor,
    WeiboCommentItem,
    WeiboCommentReply,
    WeiboCommentRepliesResult,
    WeiboCommentsResult,
    WeiboTimelineSegment,
} from '@shared/types/weibo'
import { splitPlainTextLinks } from '@shared/utils/weiboText'
import { WEIBO_AJAX_PATHS, WEIBO_WEB_ORIGIN, WEIBO_WEB_REFERER } from '../endpoints'
import { isRecord, toCount, toText } from '../guards'
import { normalizeWeiboImageUrl } from '../timeline/media'
import { parsePostSegments } from '../timeline/text'
import { parseWeiboCreatedAt } from '../timeline/time'
import { WEIBO_WEB_USER_AGENT, WeiboWebError } from '../transport/httpClient'

/** 单页默认条数：与网页端一致的 10 条 */
export const WEIBO_COMMENTS_DEFAULT_COUNT = 10

/** 单页上限：一次拉太多会明显拖慢展开评论的体感 */
const MAX_COMMENT_COUNT = 30

/** 请求超时 */
const REQUEST_TIMEOUT_MS = 15_000

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

/** 子评论（展开更多回复）参数：id 是一级评论的数字 id */
export interface FetchRepliesOptions {
    cookie: string
    /** 一级评论的数字 id */
    id: string
    /** 下一页游标：缺省拉第一页 */
    maxId?: string | null
    count?: number
    /** 当前登录用户 uid：缺省由服务端按 Cookie 识别 */
    uid?: string | null
    timeoutMs?: number
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
    const url = new URL(WEIBO_AJAX_PATHS.comments, WEIBO_WEB_ORIGIN)
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

/**
 * 构造子评论地址：与一级评论同一个端点，靠 is_mix=1 + fetch_level=1 切到回复列表，
 * id 换成一级评论的数字 id；两页都带 is_reload=1，首页 max_id 显式给 0，
 * 翻页额外带 flow=1 并换成真实游标（照网页端「显示更多评论」的两次请求取参）。
 */
export function buildRepliesUrl(options: FetchRepliesOptions): string {
    const url = new URL(WEIBO_AJAX_PATHS.comments, WEIBO_WEB_ORIGIN)
    const maxId = options.maxId?.trim() ?? ''
    const isFirstPage = maxId.length === 0
    if (!isFirstPage) {
        url.searchParams.set('flow', '1')
    }
    url.searchParams.set('is_reload', '1')
    url.searchParams.set('id', options.id)
    url.searchParams.set('is_show_bulletin', '2')
    url.searchParams.set('is_mix', '1')
    url.searchParams.set('fetch_level', '1')
    url.searchParams.set('max_id', isFirstPage ? '0' : maxId)
    url.searchParams.set('count', String(clampCommentCount(options.count)))
    const uid = options.uid?.trim() ?? ''
    if (uid.length > 0) {
        url.searchParams.set('uid', uid)
    }
    url.searchParams.set('locale', 'zh-CN')
    return url.toString()
}

/** 无 HTML 锚点时的纯文本分段：@账号与话题同样可点 */
function buildPlainSegments(text: string): WeiboTimelineSegment[] {
    return splitPlainTextLinks(text)
}

/** 正文与作者：一级评论与子评论共用一套解 HTML、还原表情的逻辑 */
interface CommentBody {
    text: string
    segments: WeiboTimelineSegment[]
    createdAt: string
    createdAtRaw: string
    author: WeiboCommentAuthor
}

/** 解析评论正文与作者：HTML 优先，缺失回退 text_raw */
function parseCommentBody(raw: Record<string, unknown>): CommentBody {
    const user = isRecord(raw.user) ? raw.user : {}
    const html = toText(raw.text)
    const segments = html.length > 0 ? parsePostSegments(html) : buildPlainSegments(toText(raw.text_raw))
    // 纯文本口径：链接只留文字、表情还原成 [名称]，便于复制与检索
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
    return {
        text,
        segments,
        createdAt: parseWeiboCreatedAt(createdAtRaw),
        createdAtRaw,
        author: {
            id: toText(user.id),
            name: toText(user.screen_name),
            avatarUrl: normalizeWeiboImageUrl(avatar) ?? '',
            // 与主贴作者同口径：只认 verified 布尔，缺失按未认证处理
            isVerified: user.verified === true,
        },
    }
}

/** 子评论预览上限：上游一般只下发 2-3 条，多留无益且会把一级评论撑高 */
const MAX_REPLY_PREVIEW = 3

/** 评论点赞态：上游用布尔或 1/0 表示，缺失按未赞处理 */
function readCommentLiked(raw: Record<string, unknown>): boolean {
    const liked = raw.liked
    return liked === true || liked === 1 || liked === '1'
}

/** 归一化单条子评论：id 缺失直接丢弃，被回复者昵称取自 reply_comment，点赞数与点赞态同口径 */
function normalizeReply(raw: unknown): WeiboCommentReply | null {
    if (!isRecord(raw)) {
        return null
    }
    const id = toText(raw.idstr) || toText(raw.id)
    if (id.length === 0) {
        return null
    }
    const replyComment = isRecord(raw.reply_comment) ? raw.reply_comment : null
    const replyUser = replyComment !== null && isRecord(replyComment.user) ? replyComment.user : null
    return {
        id,
        ...parseCommentBody(raw),
        replyToName: replyUser === null ? '' : toText(replyUser.screen_name),
        replyToUid: replyUser === null ? '' : toText(replyUser.idstr) || toText(replyUser.id),
        likes: toCount(raw.like_counts),
        isLiked: readCommentLiked(raw),
    }
}

/** 读取子评论预览：上游字段在 comments / reply_comments 间变化，两处都看 */
function readReplies(raw: Record<string, unknown>): WeiboCommentReply[] {
    const list = Array.isArray(raw.comments)
        ? raw.comments
        : Array.isArray(raw.reply_comments)
          ? raw.reply_comments
          : []
    const replies: WeiboCommentReply[] = []
    for (const item of list) {
        if (replies.length >= MAX_REPLY_PREVIEW) {
            break
        }
        const reply = normalizeReply(item)
        if (reply !== null) {
            replies.push(reply)
        }
    }
    return replies
}

/** 子评论总数：优先 total_number，回退 comments_count，两者缺失时按已下发的条数算 */
function readReplyCount(raw: Record<string, unknown>, replies: WeiboCommentReply[]): number {
    const declared = toCount(raw.total_number) || toCount(raw.comments_count)
    return Math.max(declared, replies.length)
}

/**
 * 归一化单条评论：id 缺失直接丢弃；子评论预览一并解析，回复数用于「共 N 条回复」提示。
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
    const replies = readReplies(raw)
    return {
        id,
        ...parseCommentBody(raw),
        likes: toCount(raw.like_counts),
        isLiked: readCommentLiked(raw),
        replies,
        replyCount: readReplyCount(raw, replies),
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

/**
 * 评论类 GET 的公共请求与解析：状态码、登录页与 ok 判定都在这里统一，URL 由调用方给。
 * 关键约束：一级评论与子评论只差地址参数，解析逻辑不复制两份。
 */
async function loadCommentsPayload(
    url: string,
    cookie: string,
    timeoutMs: number,
    subject: string,
): Promise<Record<string, unknown>> {
    let response: Response
    try {
        response = await fetch(url, {
            method: 'GET',
            headers: {
                Cookie: cookie,
                Referer: WEIBO_WEB_REFERER,
                'User-Agent': WEIBO_WEB_USER_AGENT,
                Accept: 'application/json, text/plain, */*',
                'X-Requested-With': 'XMLHttpRequest',
            },
            signal: AbortSignal.timeout(timeoutMs),
        })
    } catch {
        throw new WeiboWebError('network', `${subject}请求失败：请检查网络或代理设置`)
    }

    if (response.status === 401 || response.status === 403) {
        throw new WeiboWebError('unauthorized', '微博登录态已失效：请重新登录并更新 Cookie', response.status)
    }
    if (response.status === 418 || response.status === 429) {
        throw new WeiboWebError('rate-limited', `${subject}读取过于频繁：请稍后再试`, response.status)
    }
    if (!response.ok) {
        throw new WeiboWebError('upstream', `${subject}请求失败：HTTP ${String(response.status)}`, response.status)
    }

    const trimmed = (await response.text()).trim()
    if (trimmed.startsWith('<')) {
        throw new WeiboWebError('unauthorized', '微博登录态已失效：请重新登录并更新 Cookie', response.status)
    }
    let parsed: unknown
    try {
        parsed = JSON.parse(trimmed)
    } catch {
        throw new WeiboWebError('invalid-payload', `${subject}返回无法解析：接口可能已改版`, response.status)
    }
    if (!isRecord(parsed)) {
        throw new WeiboWebError('invalid-payload', `${subject}返回结构异常`, response.status)
    }
    const ok = parsed.ok
    if (typeof ok === 'number' && ok <= 0) {
        const message = typeof parsed.msg === 'string' ? parsed.msg : '未知错误'
        throw new WeiboWebError('upstream', `${subject}读取失败：${message}`, response.status)
    }
    return parsed
}

/** 拉取某条微博的评论：返回本页评论与下一页游标 */
export async function fetchPostComments(options: FetchCommentsOptions): Promise<WeiboCommentsResult> {
    const parsed = await loadCommentsPayload(
        buildCommentsUrl(options),
        options.cookie,
        options.timeoutMs ?? REQUEST_TIMEOUT_MS,
        '评论',
    )
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

/** 展开更多回复：id 为一级评论 id，返回该评论下的子评论与本页游标 */
export async function fetchCommentReplies(options: FetchRepliesOptions): Promise<WeiboCommentRepliesResult> {
    const parsed = await loadCommentsPayload(
        buildRepliesUrl(options),
        options.cookie,
        options.timeoutMs ?? REQUEST_TIMEOUT_MS,
        '回复',
    )
    const list = Array.isArray(parsed.data) ? parsed.data : []
    const replies: WeiboCommentReply[] = []
    for (const item of list) {
        const reply = normalizeReply(item)
        if (reply !== null) {
            replies.push(reply)
        }
    }
    const maxId = readCursor(parsed.max_id)
    return {
        replies,
        maxId,
        hasMore: maxId !== null && replies.length > 0,
    }
}
