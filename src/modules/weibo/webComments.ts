/**
 * 微博评论：网页版 buildComments 读取评论，comments/create 发新评论、comments/reply 回复、
 * statuses/destroyComment 删除；一级评论随列表下发的子评论预览一并归一化（最多留 3 条）。
 * 复用约定：与时间线共用登录 Cookie 与错误分类；正文切段与表情解析复用 webTimeline 的 parsePostSegments；
 * 头像与表情地址同样过图床白名单，前端仍走 weibo/image 代理加载；写操作复用 webInteraction 的 XSRF 读取
 * 与 webPublish 的 fp 指纹生成。
 * 关键约束：分页游标只取响应顶层 max_id，不能自造；首页带 is_reload=1，翻页改带 max_id；
 * uid 可选（缺省由服务端按 Cookie 识别）；文本与计数缺失一律按空串 / 0 兜底，不阻断整页；
 * 发布与回复是写操作，失败不重试，由前端提示后用户手动重发；表单参数照网页评论框实测值给，
 * 不带 forward / reply，纯文本评论的 pic_id 传空串，回复多带一个 cid。
 */
import type {
    WeiboCommentAuthor,
    WeiboCommentCreateResult,
    WeiboCommentDestroyResult,
    WeiboCommentItem,
    WeiboCommentRepliesResult,
    WeiboCommentReply,
    WeiboCommentsResult,
    WeiboTimelineSegment,
} from '@shared/types/weibo'
import { splitPlainTextLinks } from '@shared/utils/weiboText'
import { WEIBO_WEB_USER_AGENT, WeiboWebError } from './webClient'
import { readXsrfToken } from './webInteraction'
import { buildWeiboFingerprint } from './webPublish'
import { normalizeWeiboImageUrl, parsePostSegments, parseWeiboCreatedAt } from './webTimeline'
import { WEIBO_AJAX_PATHS, WEIBO_WEB_ORIGIN, WEIBO_WEB_REFERER } from './weiboEndpoints'

/** 单页默认条数：与网页端一致的 10 条 */
export const WEIBO_COMMENTS_DEFAULT_COUNT = 10

/** 单页上限：一次拉太多会明显拖慢展开评论的体感 */
const MAX_COMMENT_COUNT = 30

/** 请求超时 */
const REQUEST_TIMEOUT_MS = 15_000

/** 评论发布超时：写操作比读接口更短，失败让用户立刻重试 */
const CREATE_TIMEOUT_MS = 15_000

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

/** 评论发布参数：replyToId 给出时走回复端点 */
export interface CreateCommentOptions {
    cookie: string
    /** 微博数字 id */
    id: string
    /** 纯文本正文：调用方已 trim，长度由协议层收窄 */
    text: string
    /** 被回复评论的数字 id：缺省发新评论 */
    replyToId?: string
    timeoutMs?: number
    /** 指纹随机源：单测注入固定序列，生产用 Math.random */
    random?: () => number
}

/** 评论删除参数 */
export interface DestroyCommentOptions {
    cookie: string
    /** 被删除评论的数字 id */
    cid: string
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
        },
    }
}

/** 子评论预览上限：上游一般只下发 2-3 条，多留无益且会把一级评论撑高 */
const MAX_REPLY_PREVIEW = 3

/** 归一化单条子评论：id 缺失直接丢弃，被回复者昵称取自 reply_comment */
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

/**
 * 评论写操作的表单提交：发布 / 回复 / 删除共用一套请求头、状态码与回包解析。
 * 关键约束：与点赞一样走登录 Cookie 与 X-XSRF-TOKEN；写操作不重试；
 * 重定向到登录页的 HTML 回包按登录态失效处理；业务码由调用方各自判定，
 * 因为删除回包不保证带 ok，而发布 / 回复必须以 ok>0 为准。
 */
async function submitCommentForm(
    subject: string,
    path: string,
    cookie: string,
    form: URLSearchParams,
    timeoutMs: number,
): Promise<{ record: Record<string, unknown>; status: number }> {
    const headers: Record<string, string> = {
        Cookie: cookie,
        Referer: WEIBO_WEB_REFERER,
        Origin: WEIBO_WEB_ORIGIN,
        'User-Agent': WEIBO_WEB_USER_AGENT,
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    }
    const xsrfToken = readXsrfToken(cookie)
    if (xsrfToken !== null) {
        headers['X-XSRF-TOKEN'] = xsrfToken
    }

    let response: Response
    try {
        response = await fetch(`${WEIBO_WEB_ORIGIN}${path}`, {
            method: 'POST',
            headers,
            body: form.toString(),
            signal: AbortSignal.timeout(timeoutMs),
        })
    } catch {
        throw new WeiboWebError('network', `${subject}失败：请检查网络或代理设置`)
    }

    if (response.status === 401 || response.status === 403) {
        throw new WeiboWebError('unauthorized', '微博登录态已失效：请重新登录并更新 Cookie', response.status)
    }
    if (response.status === 418 || response.status === 429) {
        throw new WeiboWebError('rate-limited', '操作过于频繁：请稍后再试', response.status)
    }
    if (!response.ok) {
        throw new WeiboWebError('upstream', `${subject}失败：HTTP ${String(response.status)}`, response.status)
    }

    const text = (await response.text()).trim()
    if (text.startsWith('<')) {
        throw new WeiboWebError('unauthorized', '微博登录态已失效：请重新登录并更新 Cookie', response.status)
    }
    let parsed: unknown
    try {
        parsed = JSON.parse(text)
    } catch {
        throw new WeiboWebError('invalid-payload', `${subject}返回无法解析：接口可能已改版`, response.status)
    }
    if (!isRecord(parsed)) {
        throw new WeiboWebError('invalid-payload', `${subject}返回结构异常`, response.status)
    }
    return { record: parsed, status: response.status }
}

/** 业务失败判定：ok 为数字且不大于 0 时取 msg 抛错，并把「频繁 / 过快」归到限流码 */
function assertCommentAccepted(subject: string, result: { record: Record<string, unknown>; status: number }): void {
    const ok = result.record.ok
    if (typeof ok !== 'number' || ok > 0) {
        return
    }
    const message = typeof result.record.msg === 'string' ? result.record.msg : '未知错误'
    const code = message.includes('频繁') || message.includes('过快') ? 'rate-limited' : 'upstream'
    throw new WeiboWebError(code, `${subject}失败：${message}`, result.status)
}

/**
 * 发布评论：replyToId 给出时改走回复端点（多带 cid），正文与开关与网页评论框一致。
 * 复用约定：错误分类沿用 WeiboWebError，前端按码提示；正文按纯文本提交，不做表情与话题解析。
 * 关键约束：不带 forward / reply，纯文本的 pic_id 传空串，fp 用设备指纹同形随机串；
 * 回包必须以 ok>0 为准，成功时 msg 为「评论成功」或「回复成功」。
 */
export async function createPostComment(options: CreateCommentOptions): Promise<WeiboCommentCreateResult> {
    const isReply = options.replyToId !== undefined && options.replyToId.length > 0
    const form = new URLSearchParams({
        id: options.id,
        comment: options.text,
        pic_id: '',
        is_repost: '0',
        comment_ori: '0',
        is_comment: '0',
        fp: buildWeiboFingerprint(options.random ?? Math.random),
    })
    if (isReply) {
        form.set('cid', options.replyToId ?? '')
    }
    const result = await submitCommentForm(
        isReply ? '回复评论' : '评论发布',
        isReply ? WEIBO_AJAX_PATHS.replyComment : WEIBO_AJAX_PATHS.createComment,
        options.cookie,
        form,
        options.timeoutMs ?? CREATE_TIMEOUT_MS,
    )
    assertCommentAccepted(isReply ? '回复评论' : '评论发布', result)
    return { created: true }
}

/**
 * 删除评论：只提交 cid，归属由上游判定（前端只给自己的评论放入口）。
 * 关键约束：删除回包不保证带 ok，因此只有明确 ok<=0 才算失败，
 * 缺 ok 但拿到 JSON 视为成功——否则会把一次成功的删除误报成错误。
 */
export async function destroyPostComment(options: DestroyCommentOptions): Promise<WeiboCommentDestroyResult> {
    const form = new URLSearchParams({ cid: options.cid })
    const result = await submitCommentForm(
        '删除评论',
        WEIBO_AJAX_PATHS.destroyComment,
        options.cookie,
        form,
        options.timeoutMs ?? CREATE_TIMEOUT_MS,
    )
    assertCommentAccepted('删除评论', result)
    return { deleted: true }
}
