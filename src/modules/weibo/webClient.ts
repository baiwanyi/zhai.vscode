/**
 * 微博网页版 ajax 请求层：把一页关注时间线与任意网页端 JSON 取回来，不做字段归一化。
 * 复用约定：鉴权走登录态 Cookie（SUB/SUBP），与官网同源，无需开放平台的 access_token 或移动端签名；
 * 归一化在 webTimeline / webFeed，凭证存取在 webCredential，本文件只暴露 requestWeiboJson、
 * requestTimelinePage、地址构造与错误类型。
 * 关键约束：since_id 与 max_id 互斥（翻页时上游不接受 since_id），max_id 只能来自上一页响应；
 * 请求间保持最小间隔且先占位再等待（并发调用各自排队，不能同时放行），401/403/418 与超时不重试；
 * 任何错误文案与日志都不得包含 Cookie；ok:0 与 HTML 登录页都要转成带分类码的错误，调用方只按码分发。
 */
import type { WeiboTimelineErrorCode } from '@shared/types/weibo'
import {
    WEIBO_TIMELINE_DEFAULT_COUNT,
    WEIBO_TIMELINE_DEFAULT_REFRESH,
    WEIBO_TIMELINE_MAX_COUNT,
} from '@shared/types/weibo'
import { WEIBO_AJAX_PATHS, WEIBO_WEB_ORIGIN, WEIBO_WEB_REFERER } from './weiboEndpoints'

/** 相邻两次请求的最小间隔：微博对高频访问会返回 418 或空列表，1.2s 与项目内其它外部接口口径一致 */
const DEFAULT_MIN_INTERVAL_MS = 1200

/** 单次请求超时：网页端首屏通常在 1s 内返回，留足慢网余量 */
const DEFAULT_TIMEOUT_MS = 15_000

/** 失败重试次数：只对网络错误与 5xx 生效 */
const MAX_RETRIES = 2

/** 桌面端 UA：与 Chrome 157 的浏览器上下文一致，避免被当作脚本客户端 */
export const WEIBO_WEB_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36'

/** 时间线错误：带分类码，路由层原样透传给前端分发提示 */
export class WeiboWebError extends Error {
    public constructor(
        public readonly code: WeiboTimelineErrorCode,
        message: string,
        public readonly status?: number,
    ) {
        super(message)
        this.name = 'WeiboWebError'
    }
}

/** 单页请求参数 */
export interface TimelinePageQuery {
    cookie: string
    uid?: string | null
    sinceId?: string | null
    maxId?: string | null
    count?: number
    refresh?: number
    timeoutMs?: number
    /** 0 表示不做节流：仅供单测与内部批量场景 */
    minIntervalMs?: number
}

/** 单页响应：只保留分页需要的字段，statuses 保持 unknown 交给归一化层收窄 */
export interface TimelinePage {
    statuses: unknown[]
    sinceId: string | null
    maxId: string | null
}

/** 模块级节流时间戳：同一进程内所有面板共用一条节奏，避免多标签并发打满 */
let lastRequestAt = 0

/** 把数字 id 还原成完整十进制串：超过安全整数时 toLocaleString 不会退化成科学计数法 */
export function toIdString(value: unknown): string | null {
    if (typeof value === 'string') {
        return value.length > 0 ? value : null
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value.toLocaleString('fullwide', { useGrouping: false })
    }
    return null
}

/** 夹取单页条数：非法值回落到默认，超出上限按上限 */
export function clampTimelineCount(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return WEIBO_TIMELINE_DEFAULT_COUNT
    }
    const rounded = Math.trunc(value)
    if (rounded < 1) {
        return 1
    }
    return Math.min(rounded, WEIBO_TIMELINE_MAX_COUNT)
}

/**
 * 构造请求地址。
 * list_id 形如 10001{uid}：实测省略也能取到同一列表，故仅在知道 uid 时携带。
 */
export function buildTimelineUrl(query: TimelinePageQuery): string {
    const url = new URL(WEIBO_AJAX_PATHS.unreadTimeline, WEIBO_WEB_ORIGIN)
    const uid = query.uid?.trim() ?? ''
    if (uid.length > 0) {
        url.searchParams.set('list_id', `10001${uid}`)
    }
    url.searchParams.set('refresh', String(query.refresh ?? WEIBO_TIMELINE_DEFAULT_REFRESH))
    // 翻页与增量互斥：带 max_id 时上游会忽略 since_id，这里直接不传，减少歧义
    const maxId = query.maxId?.trim() ?? ''
    if (maxId.length > 0) {
        url.searchParams.set('max_id', maxId)
    } else {
        url.searchParams.set('since_id', query.sinceId?.trim() || '0')
    }
    url.searchParams.set('count', String(clampTimelineCount(query.count)))
    return url.toString()
}

/** 按状态码分类：登录态与频控分开，便于前端给出不同引导 */
function classifyStatus(status: number): WeiboTimelineErrorCode {
    if (status === 401 || status === 403) {
        return 'unauthorized'
    }
    if (status === 418 || status === 429) {
        return 'rate-limited'
    }
    return 'upstream'
}

/** 上游以 ok:0 报错时按文案细分：登录失效与频控的处置方式完全不同 */
function classifyUpstreamMessage(message: string): WeiboTimelineErrorCode {
    if (message.includes('登录') || message.includes('帐号') || message.includes('账号')) {
        return 'unauthorized'
    }
    if (message.includes('频繁') || message.includes('过快') || message.includes('太多')) {
        return 'rate-limited'
    }
    return 'upstream'
}

/**
 * 请求间最小间隔：不足则等待，保证同一进程内的请求节奏稳定。
 * 关键约束：先把本次的时间片写进 lastRequestAt 再等待——若在 await 之后才写，
 * 并发调用会同时读到旧值并一起放行，节流形同虚设（是 418 的主要来源之一）。
 */
async function reserveTurn(minIntervalMs: number): Promise<void> {
    if (minIntervalMs <= 0) {
        return
    }
    const slot = Math.max(lastRequestAt + minIntervalMs, Date.now())
    lastRequestAt = slot
    const waitMs = slot - Date.now()
    if (waitMs > 0) {
        await new Promise<void>((resolve) => {
            setTimeout(resolve, waitMs)
        })
    }
}

/** 是否为超时类错误：AbortSignal.timeout 抛 TimeoutError，AbortController 抛 AbortError */
function isTimeoutError(error: unknown): boolean {
    return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
}

/** 通用 JSON 请求入参：url 由调用方按端点构造，本层只负责鉴权头、节流与错误分类 */
export interface WeiboJsonQuery {
    url: string
    cookie: string
    timeoutMs?: number
    /** 0 表示不做节流：仅供单测与内部批量场景 */
    minIntervalMs?: number
}

/** 通用 JSON 响应：record 供调用方收窄，status 仅用于错误排障 */
export interface WeiboJsonResponse {
    record: Record<string, unknown>
    status: number
}

/** 解析响应体：HTML 登录页与 ok:0 都转成带分类码的错误，其余原样交给调用方收窄 */
function parseWeiboJsonPayload(text: string, status: number): Record<string, unknown> {
    const trimmed = text.trim()
    if (trimmed.startsWith('<')) {
        // 未登录时微博会 302 到登录页，fetch 跟随重定向后拿到的就是 HTML
        throw new WeiboWebError('unauthorized', '微博登录态已失效：请重新登录 weibo.com 并更新 Cookie', status)
    }
    let parsed: unknown
    try {
        parsed = JSON.parse(trimmed)
    } catch {
        throw new WeiboWebError('invalid-payload', '微博返回了无法解析的内容：接口可能已改版或被风控拦截', status)
    }
    if (typeof parsed !== 'object' || parsed === null) {
        throw new WeiboWebError('invalid-payload', '微博返回结构异常：缺少 JSON 对象', status)
    }
    const record = parsed as Record<string, unknown>
    const ok = record.ok
    if (ok === 0 || ok === false) {
        const message = typeof record.msg === 'string' ? record.msg : '未知错误'
        const code = classifyUpstreamMessage(message)
        throw new WeiboWebError(code, `微博接口返回失败：${message}`, status)
    }
    return record
}

/** 读取分页结果：statuses 缺失即视为结构异常，游标缺失归一为 null */
function readTimelinePage(record: Record<string, unknown>, status: number): TimelinePage {
    const statuses = record.statuses
    if (!Array.isArray(statuses)) {
        throw new WeiboWebError('invalid-payload', '微博返回结构异常：statuses 不是数组', status)
    }
    return {
        statuses,
        sinceId: toIdString(record.since_id),
        maxId: toIdString(record.max_id),
    }
}

/** 是否为可重试错误：登录态与频控重试只会加重风控 */
function isRetryable(error: WeiboWebError): boolean {
    return error.code === 'network' || error.code === 'upstream'
}

/**
 * 请求一个网页端 JSON 端点。
 * 复用同一套请求头、最小间隔与退避策略；错误分类由本层完成，调用方只处理结构收窄。
 */
export async function requestWeiboJson(query: WeiboJsonQuery): Promise<WeiboJsonResponse> {
    const timeoutMs = query.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const minIntervalMs = query.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS
    let lastError: WeiboWebError = new WeiboWebError('upstream', '微博请求未执行')

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        await reserveTurn(minIntervalMs)
        try {
            const response = await fetch(query.url, {
                method: 'GET',
                headers: {
                    // 网页端 ajax 完全依赖会话 Cookie，不校验 x-xsrf-token
                    Cookie: query.cookie,
                    Referer: WEIBO_WEB_REFERER,
                    'User-Agent': WEIBO_WEB_USER_AGENT,
                    Accept: 'application/json, text/plain, */*',
                    'X-Requested-With': 'XMLHttpRequest',
                },
                signal: AbortSignal.timeout(timeoutMs),
            })
            const text = await response.text()
            if (!response.ok) {
                throw new WeiboWebError(
                    classifyStatus(response.status),
                    response.status === 418
                        ? '微博判定访问过于频繁（418）：请降低刷新频率后重试'
                        : `微博接口请求失败：HTTP ${String(response.status)}`,
                    response.status,
                )
            }
            return { record: parseWeiboJsonPayload(text, response.status), status: response.status }
        } catch (error) {
            const isTimeout = isTimeoutError(error)
            lastError =
                error instanceof WeiboWebError
                    ? error
                    : new WeiboWebError(
                          'network',
                          isTimeout ? '微博请求超时：请检查网络或代理后重试' : '无法连接微博：请检查网络或代理设置',
                      )
            // 超时不重试：已经等满一个完整超时，再重试只会把失败时间拉长到三倍
            if (isTimeout || !isRetryable(lastError) || attempt === MAX_RETRIES) {
                throw lastError
            }
            // 指数退避：600ms、1200ms，叠加在最小间隔之上
            await new Promise<void>((resolve) => {
                setTimeout(resolve, 600 * 2 ** attempt)
            })
        }
    }
    throw lastError
}

/**
 * 请求一页关注时间线。
 * 返回原始 statuses 与两个游标；分页循环、去重与字段归一化由 webTimeline 完成。
 */
export async function requestTimelinePage(query: TimelinePageQuery): Promise<TimelinePage> {
    const response = await requestWeiboJson({
        url: buildTimelineUrl(query),
        cookie: query.cookie,
        timeoutMs: query.timeoutMs,
        minIntervalMs: query.minIntervalMs,
    })
    return readTimelinePage(response.record, response.status)
}
