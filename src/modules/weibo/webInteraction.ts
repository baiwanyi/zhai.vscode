/**
 * 微博写操作：主贴与评论的点赞 / 取消点赞（网页版 ajax 接口）。
 * 复用约定：与时间线同源，走登录 Cookie，不走开放平台 access_token；
 * 请求头补 Origin 与 X-XSRF-TOKEN（取自 Cookie 的 XSRF-TOKEN），Cookie 里没有该键时不带；
 * 评论点赞的设备指纹复用 webPublish 的 buildWeiboFingerprint，错误分类复用 WeiboWebError。
 * 关键约束：点赞是状态型写操作，同一条目标（微博或评论）的连续点击须由调用方串行化后再调本函数；
 * 主贴与评论走不同端点（setLike / cancelLike 对 updateLike / destroyLike）且参数形状不同，
 * 评论侧用 object_id + object_type=comment，取消时不带指纹；
 * 成功判定以上游 `ok > 0`（评论点赞另兼容 `result: true`）为准，HTTP 200 但 ok=0 属业务失败；
 * 401/403 不重试，避免打进风控。
 */
import type { WeiboCommentLikeResult, WeiboLikeResult } from '@shared/types/weibo'
import { WEIBO_WEB_USER_AGENT, WeiboWebError } from './webClient'
import { buildWeiboFingerprint } from './webPublish'
import { WEIBO_AJAX_PATHS, WEIBO_WEB_ORIGIN, WEIBO_WEB_REFERER } from './weiboEndpoints'

/** 写操作超时：比读接口更短，失败让用户立刻重试 */
const REQUEST_TIMEOUT_MS = 15_000

/** 点赞请求参数 */
export interface SetLikeOptions {
    cookie: string
    /** 微博数字 id（不是 mblogid） */
    id: string
    /** 目标状态：true 点赞，false 取消 */
    liked: boolean
    timeoutMs?: number
}

/** 从 Cookie 串里取 XSRF-TOKEN：写接口需要它做 CSRF 校验（点赞与发布共用） */
export function readXsrfToken(cookie: string): string | null {
    for (const pair of cookie.split(';')) {
        const [name, ...rest] = pair.trim().split('=')
        if (name === 'XSRF-TOKEN') {
            const value = rest.join('=')
            return value.length > 0 ? decodeURIComponent(value) : null
        }
    }
    return null
}

/** 解析点赞响应：ok 必须为正数，点赞数有则回传 */
function parseLikePayload(text: string, status: number, liked: boolean): WeiboLikeResult {
    const trimmed = text.trim()
    if (trimmed.startsWith('<')) {
        throw new WeiboWebError('unauthorized', '微博登录态已失效：请重新登录并更新 Cookie', status)
    }
    let parsed: unknown
    try {
        parsed = JSON.parse(trimmed)
    } catch {
        throw new WeiboWebError('invalid-payload', '点赞返回无法解析：接口可能已改版', status)
    }
    if (typeof parsed !== 'object' || parsed === null) {
        throw new WeiboWebError('invalid-payload', '点赞返回结构异常', status)
    }
    const record = parsed as Record<string, unknown>
    const ok = record.ok
    if (typeof ok !== 'number' || ok <= 0) {
        const message = typeof record.msg === 'string' ? record.msg : '未知错误'
        const code = message.includes('频繁') || message.includes('过快') ? 'rate-limited' : 'upstream'
        throw new WeiboWebError(code, `点赞失败：${message}`, status)
    }
    const data = typeof record.data === 'object' && record.data !== null ? (record.data as Record<string, unknown>) : {}
    const count = data.attitudes_count ?? record.attitudes_count
    return {
        liked,
        attitudesCount: typeof count === 'number' && Number.isFinite(count) ? Math.trunc(count) : null,
    }
}

/** 写接口公共头：Cookie、来源与 XSRF-TOKEN（Cookie 里没有该键时不带），内容类型由调用方补 */
function buildWriteHeaders(cookie: string): Record<string, string> {
    const headers: Record<string, string> = {
        Cookie: cookie,
        Referer: WEIBO_WEB_REFERER,
        Origin: WEIBO_WEB_ORIGIN,
        'User-Agent': WEIBO_WEB_USER_AGENT,
        Accept: 'application/json, text/plain, */*',
    }
    const xsrfToken = readXsrfToken(cookie)
    if (xsrfToken !== null) {
        headers['X-XSRF-TOKEN'] = xsrfToken
    }
    return headers
}

/** 点赞 / 取消点赞：调用方负责串行化同一微博的连续点击 */
export async function setPostLike(options: SetLikeOptions): Promise<WeiboLikeResult> {
    const path = options.liked ? WEIBO_AJAX_PATHS.setLike : WEIBO_AJAX_PATHS.cancelLike
    const headers = buildWriteHeaders(options.cookie)
    headers['Content-Type'] = 'application/json;charset=UTF-8'

    let response: Response
    try {
        response = await fetch(`${WEIBO_WEB_ORIGIN}${path}`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ id: options.id }),
            signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
        })
    } catch {
        throw new WeiboWebError('network', '点赞请求失败：请检查网络或代理设置')
    }

    if (response.status === 401 || response.status === 403) {
        throw new WeiboWebError('unauthorized', '微博登录态已失效：请重新登录并更新 Cookie', response.status)
    }
    if (response.status === 418 || response.status === 429) {
        throw new WeiboWebError('rate-limited', '操作过于频繁：请稍后再试', response.status)
    }
    if (!response.ok) {
        throw new WeiboWebError('upstream', `点赞失败：HTTP ${String(response.status)}`, response.status)
    }
    return parseLikePayload(await response.text(), response.status, options.liked)
}

/** 评论点赞请求参数 */
export interface SetCommentLikeOptions {
    cookie: string
    /** 评论数字 id（object_id），不是微博 id */
    cid: string
    /** 目标状态：true 点赞，false 取消 */
    liked: boolean
    /** 指纹随机源：单测可注入，默认 Math.random */
    random?: () => number
    timeoutMs?: number
}

/**
 * 解析评论点赞响应：成功以 ok > 0 为准，部分回包只给 result: true，两者取其一即可。
 * 关键约束：计数不是必回字段，缺失时回 null 由前端沿用本地增减，不当成 0 覆盖。
 */
function parseCommentLikePayload(text: string, status: number, liked: boolean): WeiboCommentLikeResult {
    const trimmed = text.trim()
    if (trimmed.startsWith('<')) {
        throw new WeiboWebError('unauthorized', '微博登录态已失效：请重新登录并更新 Cookie', status)
    }
    let parsed: unknown
    try {
        parsed = JSON.parse(trimmed)
    } catch {
        throw new WeiboWebError('invalid-payload', '评论点赞返回无法解析：接口可能已改版', status)
    }
    if (typeof parsed !== 'object' || parsed === null) {
        throw new WeiboWebError('invalid-payload', '评论点赞返回结构异常', status)
    }
    const record = parsed as Record<string, unknown>
    const isOk = (typeof record.ok === 'number' && record.ok > 0) || record.result === true
    if (!isOk) {
        const message = typeof record.msg === 'string' ? record.msg : '未知错误'
        const code = message.includes('频繁') || message.includes('过快') ? 'rate-limited' : 'upstream'
        throw new WeiboWebError(code, `评论点赞失败：${message}`, status)
    }
    const data = typeof record.data === 'object' && record.data !== null ? (record.data as Record<string, unknown>) : {}
    const count = data.like_counts ?? record.like_counts
    return {
        liked,
        likeCount: typeof count === 'number' && Number.isFinite(count) ? Math.trunc(count) : null,
    }
}

/**
 * 评论点赞 / 取消点赞：与主贴点赞不同的端点（updateLike / destroyLike），参数为 object_id + object_type。
 * 关键约束：点赞必须带设备指纹 fp、取消不带；调用方负责串行化同一评论的连续点击；
 * 写操作不重试，401/403/418 直接按分类码抛错，由前端回滚乐观状态。
 */
export async function setCommentLike(options: SetCommentLikeOptions): Promise<WeiboCommentLikeResult> {
    const path = options.liked ? WEIBO_AJAX_PATHS.likeComment : WEIBO_AJAX_PATHS.cancelLikeComment
    const headers = buildWriteHeaders(options.cookie)
    headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8'
    const form = new URLSearchParams({ object_id: options.cid, object_type: 'comment' })
    if (options.liked) {
        form.set('fp', buildWeiboFingerprint(options.random ?? Math.random))
    }

    let response: Response
    try {
        response = await fetch(`${WEIBO_WEB_ORIGIN}${path}`, {
            method: 'POST',
            headers,
            body: form,
            signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
        })
    } catch {
        throw new WeiboWebError('network', '评论点赞请求失败：请检查网络或代理设置')
    }

    if (response.status === 401 || response.status === 403) {
        throw new WeiboWebError('unauthorized', '微博登录态已失效：请重新登录并更新 Cookie', response.status)
    }
    if (response.status === 418 || response.status === 429) {
        throw new WeiboWebError('rate-limited', '操作过于频繁：请稍后再试', response.status)
    }
    if (!response.ok) {
        throw new WeiboWebError('upstream', `评论点赞失败：HTTP ${String(response.status)}`, response.status)
    }
    return parseCommentLikePayload(await response.text(), response.status, options.liked)
}

/** 转发点赞请求参数 */
export interface SetRepostLikeOptions {
    cookie: string
    /** 转发（status）数字 id */
    id: string
    /** 目标状态：true 点赞，false 取消 */
    liked: boolean
    /** 指纹随机源：单测可注入，默认 Math.random */
    random?: () => number
    timeoutMs?: number
}

/**
 * 解析转发点赞响应：成功以 ok > 0 或 result: true 为准。
 * 关键约束：点赞回包根层就是这条转发本身，计数取它的 attitudes_count；取消通常只回结果，
 * 计数缺失时回 null，由前端沿用本地增减。
 */
function parseRepostLikePayload(text: string, status: number, liked: boolean): WeiboLikeResult {
    const trimmed = text.trim()
    if (trimmed.startsWith('<')) {
        throw new WeiboWebError('unauthorized', '微博登录态已失效：请重新登录并更新 Cookie', status)
    }
    let parsed: unknown
    try {
        parsed = JSON.parse(trimmed)
    } catch {
        throw new WeiboWebError('invalid-payload', '转发点赞返回无法解析：接口可能已改版', status)
    }
    if (typeof parsed !== 'object' || parsed === null) {
        throw new WeiboWebError('invalid-payload', '转发点赞返回结构异常', status)
    }
    const record = parsed as Record<string, unknown>
    const isOk = (typeof record.ok === 'number' && record.ok > 0) || record.result === true
    if (!isOk) {
        const message = typeof record.msg === 'string' ? record.msg : '未知错误'
        const code = message.includes('频繁') || message.includes('过快') ? 'rate-limited' : 'upstream'
        throw new WeiboWebError(code, `转发点赞失败：${message}`, status)
    }
    const target =
        typeof record.status === 'object' && record.status !== null ? (record.status as Record<string, unknown>) : {}
    const count = target.attitudes_count ?? record.attitudes_count
    return {
        liked,
        attitudesCount: typeof count === 'number' && Number.isFinite(count) ? Math.trunc(count) : null,
    }
}

/**
 * 转发点赞 / 取消点赞：与主贴同一个端点，参数走 form 且点赞带设备指纹。
 * 关键约束：点赞提交 id + fp，取消只提交 id；调用方负责串行化同一条转发的连点；
 * 写操作不重试，401/403/418 直接按分类码抛错，由前端回滚乐观状态。
 */
export async function setRepostLike(options: SetRepostLikeOptions): Promise<WeiboLikeResult> {
    const path = options.liked ? WEIBO_AJAX_PATHS.setLike : WEIBO_AJAX_PATHS.cancelLike
    const headers = buildWriteHeaders(options.cookie)
    headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8'
    const form = new URLSearchParams({ id: options.id })
    if (options.liked) {
        form.set('fp', buildWeiboFingerprint(options.random ?? Math.random))
    }

    let response: Response
    try {
        response = await fetch(`${WEIBO_WEB_ORIGIN}${path}`, {
            method: 'POST',
            headers,
            body: form,
            signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
        })
    } catch {
        throw new WeiboWebError('network', '转发点赞请求失败：请检查网络或代理设置')
    }

    if (response.status === 401 || response.status === 403) {
        throw new WeiboWebError('unauthorized', '微博登录态已失效：请重新登录并更新 Cookie', response.status)
    }
    if (response.status === 418 || response.status === 429) {
        throw new WeiboWebError('rate-limited', '操作过于频繁：请稍后再试', response.status)
    }
    if (!response.ok) {
        throw new WeiboWebError('upstream', `转发点赞失败：HTTP ${String(response.status)}`, response.status)
    }
    return parseRepostLikePayload(await response.text(), response.status, options.liked)
}
