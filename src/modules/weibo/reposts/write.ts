/**
 * 微博转发写入：normal_repost 提交转发 / 转发并评论，statuses/destroy 删除微博或转发。
 * 复用约定：与点赞共用登录 Cookie 与 X-XSRF-TOKEN，设备指纹取 webPublish 的稳定派生实现；
 * 评论并转发走评论写模块的 is_repost=1 单请求，由上游同时生成评论与转发。
 * 关键约束：附言可为空（纯转发）；三种方式按实测参数分支（is_comment 0/1）；
 * 删除回包不是 { ok, data } 包装而是被删对象本身，只有 ok 明确不大于 0 才算失败；写操作不重试。
 */
import type { WeiboDestroyStatusResult, WeiboRepostCreateResult, WeiboRepostMode } from '@shared/types/weibo'
import { readXsrfToken } from '../api/write/interaction'
import { buildStableFingerprint } from '../api/write/publish'
import { createPostComment } from '../comments/write'
import { WEIBO_AJAX_PATHS, WEIBO_WEB_ORIGIN, WEIBO_WEB_REFERER } from '../endpoints'
import { isRecord } from '../guards'
import { WEIBO_WEB_USER_AGENT, WeiboWebError } from '../transport/httpClient'

/** 转发（写操作）超时：与评论写操作同口径，失败要尽快让用户重试 */
const MUTATE_TIMEOUT_MS = 15_000

/** 删除微博参数：转发与自己发的微博都按 status id 删 */
export interface DestroyStatusOptions {
    cookie: string
    /** 微博数字 id */
    id: string
    timeoutMs?: number
}

/** 转发提交参数 */
export interface CreateRepostOptions {
    cookie: string
    /** 微博数字 id */
    id: string
    /** 转发附言：纯转发传空串 */
    comment: string
    /** 转发方式：缺省只转发 */
    mode?: WeiboRepostMode
    timeoutMs?: number
    /** 指纹随机源：单测注入固定序列，生产用 Math.random */
    random?: () => number
}

/**
 * 提交转发表单：走登录 Cookie 与 X-XSRF-TOKEN，状态码与回包判定集中在这一处。
 * 关键约束：回包 `msg` 为「转发成功」，成功判定同发布（ok > 0）；写操作不重试。
 */
async function submitRepostForm(
    subject: string,
    cookie: string,
    form: URLSearchParams,
    timeoutMs: number,
): Promise<void> {
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
        response = await fetch(`${WEIBO_WEB_ORIGIN}${WEIBO_AJAX_PATHS.normalRepost}`, {
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
    if (typeof ok !== 'number' || ok <= 0) {
        const message = typeof parsed.msg === 'string' ? parsed.msg : '未知错误'
        const code = message.includes('频繁') || message.includes('过快') ? 'rate-limited' : 'upstream'
        throw new WeiboWebError(code, `${subject}失败：${message}`, response.status)
    }
}

/**
 * 转发微博：网页版 normal_repost 表单提交，与评论发布一样走登录 Cookie 与 X-XSRF-TOKEN。
 * 复用约定：错误分类沿用 WeiboWebError；附言直接按文本提交，表情以 `[名称]` 交给上游转图片。
 * 关键约束：附言可为空（纯转发）；三种方式按实测参数分支——
 * 只转发与转发并评论都走 normal_repost，带 visible / share_id（is_comment 分别为 0 / 1）；
 * 评论并转发走 comments/create 的 is_repost=1，一次请求同时生成评论与转发
 * （回包 data.repostId 即转发 id，不需要第二次请求）；
 * 回包缺 repostId 时按部分成功返回 { reposted: false, commented: true, failureMessage }，
 * 避免用户重试把同一条评论发重；写操作不重试。
 */
export async function createPostRepost(options: CreateRepostOptions): Promise<WeiboRepostCreateResult> {
    const mode = options.mode ?? 'repost'
    const fingerprint = buildStableFingerprint(options.cookie)
    const common = { id: options.id, comment: options.comment, pic_id: '' }
    const timeoutMs = options.timeoutMs ?? MUTATE_TIMEOUT_MS

    if (mode === 'commentWithRepost') {
        // 实测：comments/create 带 is_repost=1 会一次生成「评论 + 转发」，回包 data.repostId 即转发 id，
        // 不再需要第二次 normal_repost（原先两步的失败补偿随之取消）
        const result = await createPostComment({
            cookie: options.cookie,
            id: options.id,
            text: options.comment,
            timeoutMs: options.timeoutMs,
            repost: true,
        })
        if (result.reposted === true) {
            return { reposted: true, commented: true }
        }
        // 评论已发出但回包没带转发 id：按部分成功交给前端，避免用户重试把评论发重
        return { reposted: false, commented: true, failureMessage: '评论已发布，但转发未生成' }
    }

    const isComment = mode === 'repostWithComment'
    // 字段集合照网页端实测逐项对齐：转发并评论仍带 visible 与 share_id
    const form = new URLSearchParams({
        ...common,
        is_repost: '0',
        comment_ori: '0',
        is_comment: isComment ? '1' : '0',
        visible: '0',
        share_id: '',
        fp: fingerprint,
    })
    await submitRepostForm(isComment ? '转发并评论' : '转发', options.cookie, form, timeoutMs)
    // 转发并评论虽是一条过，但回包只给 data.statuses（新建转发），不含评论 id，
    // 因此 commented 只能按传参声明；客户端无法核实评论是否真的落地，不要把它当事实。
    return { reposted: true, commented: isComment }
}

/**
 * 删除微博（含转发）：网页版 statuses/destroy 表单提交，只带微博 id。
 * 关键约束：回包不是 { ok, data } 包装，而是被删除的微博对象本身、末尾才带 ok，
 * 因此只有 ok 明确不大于 0 才算失败；ok 缺失但回包带 id 时视为成功；
 * 归属由上游判定（前端只给自己的转发 / 微博放入口）；写操作不重试。
 */
export async function destroyPostStatus(options: DestroyStatusOptions): Promise<WeiboDestroyStatusResult> {
    const headers: Record<string, string> = {
        Cookie: options.cookie,
        Referer: WEIBO_WEB_REFERER,
        Origin: WEIBO_WEB_ORIGIN,
        'User-Agent': WEIBO_WEB_USER_AGENT,
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    }
    const xsrfToken = readXsrfToken(options.cookie)
    if (xsrfToken !== null) {
        headers['X-XSRF-TOKEN'] = xsrfToken
    }
    const form = new URLSearchParams({ id: options.id })

    let response: Response
    try {
        response = await fetch(`${WEIBO_WEB_ORIGIN}${WEIBO_AJAX_PATHS.destroyStatus}`, {
            method: 'POST',
            headers,
            body: form.toString(),
            signal: AbortSignal.timeout(options.timeoutMs ?? MUTATE_TIMEOUT_MS),
        })
    } catch {
        throw new WeiboWebError('network', '删除失败：请检查网络或代理设置')
    }

    if (response.status === 401 || response.status === 403) {
        throw new WeiboWebError('unauthorized', '微博登录态已失效：请重新登录并更新 Cookie', response.status)
    }
    if (response.status === 418 || response.status === 429) {
        throw new WeiboWebError('rate-limited', '操作过于频繁：请稍后再试', response.status)
    }
    if (!response.ok) {
        throw new WeiboWebError('upstream', `删除失败：HTTP ${String(response.status)}`, response.status)
    }

    const trimmed = (await response.text()).trim()
    if (trimmed.startsWith('<')) {
        throw new WeiboWebError('unauthorized', '微博登录态已失效：请重新登录并更新 Cookie', response.status)
    }
    let parsed: unknown
    try {
        parsed = JSON.parse(trimmed)
    } catch {
        throw new WeiboWebError('invalid-payload', '删除返回无法解析：接口可能已改版', response.status)
    }
    if (!isRecord(parsed)) {
        throw new WeiboWebError('invalid-payload', '删除返回结构异常', response.status)
    }
    const ok = parsed.ok
    if (typeof ok === 'number' && ok <= 0) {
        const message = typeof parsed.msg === 'string' ? parsed.msg : '未知错误'
        const code = message.includes('频繁') || message.includes('过快') ? 'rate-limited' : 'upstream'
        throw new WeiboWebError(code, `删除失败：${message}`, response.status)
    }
    return { deleted: true }
}
