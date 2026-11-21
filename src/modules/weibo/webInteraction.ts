/**
 * 微博写操作：当前只做点赞与取消点赞（网页版 ajax 接口）。
 * 复用约定：与时间线同源，走登录 Cookie，不走开放平台 access_token；
 * 请求头补 Origin 与 X-XSRF-TOKEN（取自 Cookie 的 XSRF-TOKEN），Cookie 里没有该键时不带；
 * 错误分类复用 WeiboWebError，前端按码提示。
 * 关键约束：点赞是状态型写操作，同一微博的连续点击须由调用方串行化后再调本函数；
 * 成功判定以上游 `ok > 0` 为准，HTTP 200 但 ok=0 属业务失败；401/403 不重试，避免打进风控。
 */
import type { WeiboLikeResult } from '@shared/types/weibo'
import { WEIBO_WEB_USER_AGENT, WeiboWebError } from './webClient'
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

/** 点赞 / 取消点赞：调用方负责串行化同一微博的连续点击 */
export async function setPostLike(options: SetLikeOptions): Promise<WeiboLikeResult> {
    const path = options.liked ? WEIBO_AJAX_PATHS.setLike : WEIBO_AJAX_PATHS.cancelLike
    const headers: Record<string, string> = {
        Cookie: options.cookie,
        Referer: WEIBO_WEB_REFERER,
        Origin: WEIBO_WEB_ORIGIN,
        'User-Agent': WEIBO_WEB_USER_AGENT,
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json;charset=UTF-8',
    }
    const xsrfToken = readXsrfToken(options.cookie)
    if (xsrfToken !== null) {
        headers['X-XSRF-TOKEN'] = xsrfToken
    }

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
