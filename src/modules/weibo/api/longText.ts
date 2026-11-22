/**
 * 微博长文读取：网页版 longtext 接口，只读。
 * 复用约定：与时间线共用登录 Cookie 与错误分类；id 用 mblogid（如 `Rs4KtdzoV`），数字 id 也能取到。
 * 关键约束：正文优先 `longTextContent`，缺失回退 `longTextContent_raw`；
 * 两者都为空视为业务失败，避免拿空串覆盖卡片上的摘要；
 * 全文是纯文本（换行原样保留），不再按表情分段——长文接口不返回 HTML。
 */
import type { WeiboLongTextResult } from '@shared/types/weibo'
import { WEIBO_AJAX_PATHS, WEIBO_WEB_ORIGIN, WEIBO_WEB_REFERER } from '../endpoints'
import { isRecord } from '../guards'
import { WEIBO_WEB_USER_AGENT, WeiboWebError } from '../transport/httpClient'

/** 请求超时 */
const REQUEST_TIMEOUT_MS = 15_000

/** 长文请求参数 */
export interface FetchLongTextOptions {
    cookie: string
    /** mblogid 或数字 id */
    id: string
    timeoutMs?: number
}

/** 构造长文请求地址 */
export function buildLongTextUrl(id: string): string {
    const url = new URL(WEIBO_AJAX_PATHS.longText, WEIBO_WEB_ORIGIN)
    url.searchParams.set('id', id)
    return url.toString()
}

/** 解析长文响应：优先 longTextContent，空则回退 raw，二者皆空按失败处理 */
export function parseLongTextPayload(text: string, status: number): WeiboLongTextResult {
    const trimmed = text.trim()
    if (trimmed.startsWith('<')) {
        throw new WeiboWebError('unauthorized', '微博登录态已失效：请重新登录并更新 Cookie', status)
    }
    let parsed: unknown
    try {
        parsed = JSON.parse(trimmed)
    } catch {
        throw new WeiboWebError('invalid-payload', '长文返回无法解析：接口可能已改版', status)
    }
    if (!isRecord(parsed)) {
        throw new WeiboWebError('invalid-payload', '长文返回结构异常', status)
    }
    const ok = parsed.ok
    if (typeof ok === 'number' && ok <= 0) {
        const message = typeof parsed.msg === 'string' ? parsed.msg : '未知错误'
        throw new WeiboWebError('upstream', `长文读取失败：${message}`, status)
    }
    const data = isRecord(parsed.data) ? parsed.data : {}
    const content = typeof data.longTextContent === 'string' ? data.longTextContent.trim() : ''
    const raw = typeof data.longTextContent_raw === 'string' ? data.longTextContent_raw.trim() : ''
    const body = content.length > 0 ? content : raw
    if (body.length === 0) {
        throw new WeiboWebError('upstream', '长文内容为空：该条可能不是长文或已删除', status)
    }
    return { text: body }
}

/** 拉取长文全文 */
export async function fetchLongText(options: FetchLongTextOptions): Promise<WeiboLongTextResult> {
    let response: Response
    try {
        response = await fetch(buildLongTextUrl(options.id), {
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
        throw new WeiboWebError('network', '长文请求失败：请检查网络或代理设置')
    }

    if (response.status === 401 || response.status === 403) {
        throw new WeiboWebError('unauthorized', '微博登录态已失效：请重新登录并更新 Cookie', response.status)
    }
    if (response.status === 418 || response.status === 429) {
        throw new WeiboWebError('rate-limited', '长文读取过于频繁：请稍后再试', response.status)
    }
    if (!response.ok) {
        throw new WeiboWebError('upstream', `长文请求失败：HTTP ${String(response.status)}`, response.status)
    }
    return parseLongTextPayload(await response.text(), response.status)
}
