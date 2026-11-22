/**
 * 微博评论写入：发评论、回复评论与删除评论，统一按 form 提交。
 * 复用约定：与点赞共用登录 Cookie 与 X-XSRF-TOKEN，设备指纹取 webPublish 的稳定派生实现；
 * 状态码分类、登录页识别与回包解析复用同一份提交函数。
 * 关键约束：写操作一律不重试，失败由前端提示后用户手动重发；
 * 发布 / 回复必须以 ok>0 为准，删除回包不保证带 ok（缺 ok 但拿到 JSON 视为成功）；
 * 「评论并转发」由同一次请求带 is_repost=1 生成，回包 data.repostId 存在即表示转发成功。
 */
import type { WeiboCommentCreateResult, WeiboCommentDestroyResult } from '@shared/types/weibo'
import { readXsrfToken } from '../api/write/interaction'
import { buildStableFingerprint } from '../api/write/publish'
import { WEIBO_WEB_ORIGIN, WEIBO_WEB_REFERER, WEIBO_AJAX_PATHS } from '../endpoints'
import { isRecord } from '../guards'
import { WEIBO_WEB_USER_AGENT, WeiboWebError } from '../transport/httpClient'

/** 评论发布超时：写操作比读接口更短，失败让用户立刻重试 */
const CREATE_TIMEOUT_MS = 15_000

/** 评论发布参数：replyToId 给出时走回复端点 */
export interface CreateCommentOptions {
    cookie: string
    /** 微博数字 id */
    id: string
    /** 纯文本正文：调用方已 trim，长度由协议层收窄 */
    text: string
    /** 被回复评论的数字 id：缺省发新评论 */
    replyToId?: string
    /** 同时转发：对应网页「评论并转发」，is_repost=1，一次请求同时生成转发 */
    repost?: boolean
    timeoutMs?: number
    /** 指纹随机源：保留字段兼容旧调用方，指纹已改为按 Cookie 稳定派生，不再使用 */
    random?: () => number
}

/** 评论删除参数 */
export interface DestroyCommentOptions {
    cookie: string
    /** 被删除评论的数字 id */
    cid: string
    timeoutMs?: number
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

/** 读回包里的转发 id：评论并转发成功时 `data.repostId` 存在，普通评论没有该字段 */
function readRepostId(record: Record<string, unknown>): string | null {
    const data = record.data
    if (!isRecord(data)) {
        return null
    }
    const value = data.repostId
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value)
    }
    return typeof value === 'string' && value.length > 0 ? value : null
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
        // 评论并转发：同一次请求里带 is_repost=1 由上游生成转发，回包 data.repostId 即转发 id
        is_repost: options.repost === true ? '1' : '0',
        comment_ori: '0',
        is_comment: '0',
        fp: buildStableFingerprint(options.cookie),
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
    if (options.repost === true) {
        return { created: true, reposted: readRepostId(result.record) !== null }
    }
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
