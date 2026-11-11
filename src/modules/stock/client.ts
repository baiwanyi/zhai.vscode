/**
 * Unsplash 客户端：搜索、话题浏览、详情、下载与下载计数，并把限流与网络失败归一成可执行提示。
 * 复用约定：统一走 Node 内置 fetch，不引第三方 SDK；密钥只放请求头，配置经 common/config 每次即时求值；
 * 错误码归一集中在本文件，服务层与页面不再各自拼接文案。
 * 关键约束：三道闸门（冷却 → 小时窗口 → 最小间隔）只在 API 域生效，图片 CDN 不占接口配额；
 * 429 按 Retry-After 进入冷却期间不得再发请求；401 / 403 不重试，5xx 与网络失败才退避重试；
 * 密钥、完整请求 URL 与响应体都不得进日志。
 */
import { getZhaiConfig } from '@modules/common/config'
import { logger } from '@modules/common/logger'
import type { StockOrderBy, StockOrientation } from '@shared/types/stock'
import {
    DOWNLOAD_TIMEOUT_MS,
    MAX_PER_PAGE,
    MIN_PER_PAGE,
    RATE_WINDOW_MS,
    SEARCH_TIMEOUT_MS,
    MAX_RETRY,
} from './constants'
import type { CachedStockPhoto, StockPhotoUrls } from './cache'

/** 接口根地址：查询类接口都在 api.unsplash.com 上 */
const API_BASE = 'https://api.unsplash.com'
/** 关键词搜索 */
const SEARCH_PATH = '/search/photos'
/** 无关键词浏览最新 */
const LIST_PATH = '/photos'
/** 话题列表与话题内浏览：后者形如 /topics/{slug}/photos */
const TOPICS_PATH = '/topics'

/** 错误码：服务层据此决定提示形态（是否打开密钥弹窗、是否展示重试） */
export type StockErrorCode =
    'not-configured' | 'invalid-key' | 'forbidden' | 'rate-limited' | 'network' | 'server' | 'bad-response'

/** 在线图库错误：带错误码与「是否值得重试」，路由层直接透传 message */
export class StockApiError extends Error {
    public readonly code: StockErrorCode

    public readonly retryable: boolean

    public constructor(code: StockErrorCode, message: string, retryable = false) {
        super(message)
        this.name = 'StockApiError'
        this.code = code
        this.retryable = retryable
    }
}

/** 一页搜索结果 */
export interface StockSearchPage {
    photos: CachedStockPhoto[]
    /** 命中的总条数：无关键词浏览时上游不给，按本页是否有下一页估算 */
    total: number
    totalPages: number
}

/** 下载结果：字节与真实类型同源，避免扩展名与实际格式错位 */
export interface StockDownloadResult {
    bytes: Uint8Array
    /** 不带点的扩展名：jpg / webp / png */
    extension: string
    byteSize: number
}

/** 最近一次响应后的限流快照 */
export interface StockRateSnapshot {
    remaining: number | null
    cooldownUntil: string | null
}

/** 睡一段时间：最小间隔与退避共用 */
async function sleep(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
        setTimeout(resolve, ms)
    })
}

/** 收窄错误文本：宿主侧不依赖前端工具，单独归一 */
function errorText(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause)
}

/** 收敛整数：非法值回落默认，越界夹到上下限 */
function clamp(value: number, fallback: number, min: number, max: number): number {
    if (!Number.isFinite(value)) {
        return fallback
    }
    return Math.min(Math.max(Math.floor(value), min), max)
}

/** 追加 utm 参数：Unsplash 要求署名链接带来源标识 */
function withUtm(url: string): string {
    try {
        const target = new URL(url)
        target.searchParams.set('utm_source', 'zhai')
        target.searchParams.set('utm_medium', 'referral')
        return target.toString()
    } catch {
        return url
    }
}

/** 取字符串字段：缺失或类型不符返回空串 */
function readString(source: Record<string, unknown>, key: string): string {
    const value = source[key]
    return typeof value === 'string' ? value : ''
}

/** 取数字字段：缺失或非有限数返回 null */
function readNumber(source: Record<string, unknown>, key: string): number | null {
    const value = source[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** 从嵌套对象取字符串：任一层缺失都返回空串 */
function readNestedString(source: Record<string, unknown>, parent: string, key: string): string {
    const nested = source[parent]
    if (typeof nested !== 'object' || nested === null) {
        return ''
    }
    return readString(nested as Record<string, unknown>, key)
}

/**
 * 把上游条目收窄成本地结构：缺 id 或没有任何下载入口时返回 null，由调用方丢弃该条。
 * 关键约束：alt 三级回退（alt_description → description → 空串），署名缺失显示「未署名」。
 */
function parsePhoto(raw: unknown): CachedStockPhoto | null {
    if (typeof raw !== 'object' || raw === null) {
        return null
    }
    const source = raw as Record<string, unknown>
    const id = readString(source, 'id')
    if (!/^[A-Za-z0-9_-]{5,32}$/u.test(id)) {
        return null
    }
    const urls = typeof source.urls === 'object' && source.urls !== null ? (source.urls as Record<string, unknown>) : {}
    // 四档地址按需保留：raw / full / regular 全缺时无法插入，直接丢弃该条
    const photoUrls: StockPhotoUrls = {
        raw: readString(urls, 'raw') || null,
        full: readString(urls, 'full') || null,
        regular: readString(urls, 'regular') || null,
        small: readString(urls, 'small') || null,
    }
    if (photoUrls.raw === null && photoUrls.full === null && photoUrls.regular === null) {
        return null
    }
    const alt = readString(source, 'alt_description') || readString(source, 'description')
    const photographer = readNestedString(source, 'user', 'name')
    const photographerLink = readNestedString(source, 'user', 'links')
    const links =
        typeof source.links === 'object' && source.links !== null ? (source.links as Record<string, unknown>) : {}
    return {
        id,
        width: readNumber(source, 'width') ?? 0,
        height: readNumber(source, 'height') ?? 0,
        alt,
        photographer: photographer.length === 0 ? '未署名' : photographer,
        photographerUrl: photographerLink.length === 0 ? '' : withUtm(photographerLink),
        urls: photoUrls,
        downloadLocation: readString(links, 'download_location') || null,
    }
}

/** 搜索目标路径：话题优先（话题端点不支持关键词），其次关键词搜索，最后浏览最新 */
function resolveSearchPath(input: { query: string; topic: string | null }): string {
    if (input.topic !== null) {
        return `${TOPICS_PATH}/${encodeURIComponent(input.topic)}/photos`
    }
    return input.query.length > 0 ? SEARCH_PATH : LIST_PATH
}

/** 从响应头读服务端剩余额度：缺失按未知处理 */
function readRemaining(headers: Headers): number | null {
    const raw = headers.get('x-ratelimit-remaining')
    if (raw === null) {
        return null
    }
    const parsed = Number.parseInt(raw, 10)
    return Number.isFinite(parsed) ? parsed : null
}

/** 从 Retry-After 读冷却秒数：缺省或非法值按 60 秒处理 */
function readRetryAfter(headers: Headers): number {
    const raw = headers.get('retry-after')
    if (raw === null) {
        return 60
    }
    const parsed = Number.parseInt(raw, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 60
}

/**
 * Unsplash 客户端：持有本地限流状态，是唯一发请求的地方。
 * @param readAccessKey 密钥读取：由装配处注入 SecretStorage 读取器，缺省即未配置
 */
export class StockClient {
    /** 最近一小时内的请求时刻：滑动窗口的计数依据 */
    private readonly stamps: number[] = []

    /** 限流冷却截止时刻（毫秒时间戳）：0 表示未冷却 */
    private cooldownUntil = 0

    /** 服务端剩余额度：每次响应后覆盖 */
    private remaining: number | null = null

    public constructor(private readonly readAccessKey: () => Promise<string | undefined>) {}

    /**
     * 当前限流快照：页面页头与状态回执共用。
     * 关键约束：服务端剩余在本进程第一次成功响应前是未知值，此时用本地窗口估算兜底
     * （配置上限减窗口内已用次数），保证页头配额胶囊恒有值可显；两者都有时取更小者。
     */
    public getSnapshot(): StockRateSnapshot {
        const now = Date.now()
        this.trimWindow(now)
        const limit = getZhaiConfig().stockHourlyLimit
        const localRemaining = limit > 0 ? Math.max(0, limit - this.stamps.length) : null
        const remaining =
            this.remaining !== null && localRemaining !== null
                ? Math.min(this.remaining, localRemaining)
                : (this.remaining ?? localRemaining)
        return {
            remaining,
            cooldownUntil: this.cooldownUntil === 0 ? null : new Date(this.cooldownUntil).toISOString(),
        }
    }

    /** 重置本地限流状态：密钥变更或存储根切换后调用 */
    public reset(): void {
        this.stamps.length = 0
        this.cooldownUntil = 0
        this.remaining = null
    }

    /** 可用密钥：未配置直接抛错，避免把 401 当成密钥错误提示 */
    public async hasAccessKey(): Promise<boolean> {
        const key = await this.readAccessKey()
        return key !== undefined && key.length > 0
    }

    /**
     * 搜索或浏览。
     * @param query 关键词：空串表示浏览最新
     * @param topic 话题 slug：给出时浏览该话题，此时 query 与 orientation 不参与
     * @param orderBy 浏览流排序：不给则尊重上游默认（/photos 为 latest，话题流为 position）；搜索端点不支持
     */
    public async search(input: {
        query: string
        page: number
        orientation: StockOrientation | null
        topic: string | null
        orderBy: StockOrderBy | null
    }): Promise<StockSearchPage> {
        const config = getZhaiConfig()
        const perPage = clamp(config.stockPerPage, 20, MIN_PER_PAGE, MAX_PER_PAGE)
        const isSearch = input.topic === null && input.query.length > 0
        const url = new URL(resolveSearchPath(input), API_BASE)
        url.searchParams.set('page', String(input.page))
        url.searchParams.set('per_page', String(perPage))
        if (isSearch) {
            url.searchParams.set('query', input.query)
            url.searchParams.set('content_filter', 'high')
            if (input.orientation !== null) {
                url.searchParams.set('orientation', input.orientation)
            }
        } else if (input.orderBy !== null) {
            url.searchParams.set('order_by', input.orderBy)
        } else if (input.topic === null) {
            url.searchParams.set('order_by', 'latest')
        }

        const payload = await this.requestJson(url)
        if (isSearch) {
            const source = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {}
            const results = Array.isArray(source.results) ? source.results : []
            const total = typeof source.total === 'number' ? source.total : results.length
            const totalPages = typeof source.total_pages === 'number' ? source.total_pages : input.page
            return {
                photos: results
                    .map((item) => parsePhoto(item))
                    .filter((item): item is CachedStockPhoto => item !== null),
                total,
                totalPages,
            }
        }
        const rows = Array.isArray(payload) ? payload : []
        return {
            photos: rows.map((item) => parsePhoto(item)).filter((item): item is CachedStockPhoto => item !== null),
            total: rows.length,
            totalPages: rows.length === 0 ? input.page : input.page + 1,
        }
    }

    /** 单张回源：缓存过期或进程重启后按 id 取详情 */
    public async photo(photoId: string): Promise<CachedStockPhoto> {
        const url = new URL(`${LIST_PATH}/${encodeURIComponent(photoId)}`, API_BASE)
        const payload = await this.requestJson(url)
        const photo = parsePhoto(payload)
        if (photo === null) {
            throw new StockApiError('bad-response', '图片详情返回无法解析，请重新搜索')
        }
        return photo
    }

    /**
     * 触发一次下载计数：Unsplash 条款要求下载行为必须被统计。
     * 关键约束：失败只记日志，绝不影响插入——用户拿到图才是第一位的。
     */
    public async trackDownload(location: string): Promise<void> {
        try {
            const key = await this.readAccessKey()
            if (key === undefined) {
                return
            }
            await this.guard()
            await this.send(new URL(location), key, SEARCH_TIMEOUT_MS, 0)
        } catch (error) {
            logger.warn(`下载计数失败（不影响插入）：${errorText(error)}`)
        }
    }

    /**
     * 下载图片本体：只走 CDN，不占接口配额，因此不进闸门也不重试整轮配额。
     * 关键约束：width 为 null 时保留上游原生档位（raw / full / regular / small），不追加 w / q / fm；
     * content-type 必须以 image/ 开头——CDN 出错时返回的 HTML 错误页不能当图片写盘。
     */
    public async download(url: string, width: number | null): Promise<StockDownloadResult> {
        const target = new URL(url)
        if (width !== null) {
            target.searchParams.set('w', String(width))
            target.searchParams.set('q', '85')
            target.searchParams.set('fm', 'jpg')
        }

        let response: Response
        try {
            response = await fetch(target, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
        } catch (cause) {
            throw new StockApiError('network', `图片下载失败：${errorText(cause)}`, true)
        }
        if (!response.ok) {
            throw new StockApiError('server', `图片下载失败：HTTP ${String(response.status)}`, true)
        }
        const contentType = response.headers.get('content-type') ?? ''
        if (!contentType.toLowerCase().startsWith('image/')) {
            throw new StockApiError('bad-response', '下载到的内容不是图片，请重试', true)
        }
        let bytes: Uint8Array
        try {
            bytes = new Uint8Array(await response.arrayBuffer())
        } catch (cause) {
            throw new StockApiError('network', `图片读取失败：${errorText(cause)}`, true)
        }
        if (bytes.byteLength === 0) {
            throw new StockApiError('bad-response', '下载到的图片为空，请重试', true)
        }
        return { bytes, extension: readExtension(contentType), byteSize: bytes.byteLength }
    }

    /** 请求 JSON：闸门 → 重试 → 反序列化，失败一律抛 StockApiError；返回原样结构，数组与对象由调用方判别 */
    private async requestJson(url: URL): Promise<unknown> {
        const key = await this.requireKey()
        await this.guard()
        const response = await this.send(url, key, SEARCH_TIMEOUT_MS, MAX_RETRY)
        this.remaining = readRemaining(response.headers) ?? this.remaining
        let raw: unknown
        try {
            raw = await response.json()
        } catch (cause) {
            throw new StockApiError('bad-response', `接口返回无法解析：${errorText(cause)}`)
        }
        if (typeof raw !== 'object' || raw === null) {
            throw new StockApiError('bad-response', '接口返回格式异常')
        }
        return raw
    }

    /** 取密钥：未配置时给出配置指引而不是网络错误 */
    private async requireKey(): Promise<string> {
        const key = await this.readAccessKey()
        if (key === undefined || key.length === 0) {
            throw new StockApiError('not-configured', '还没有配置 Unsplash Access Key，请先在在线图库页填写')
        }
        return key
    }

    /**
     * 三道闸门：冷却 → 小时窗口 → 最小间隔。
     * 关键约束：放行前不计数，计数在真正发出请求时进行（见 send），重试同样占用配额。
     */
    private async guard(): Promise<void> {
        const now = Date.now()
        if (this.cooldownUntil > now) {
            const waitMinutes = Math.max(1, Math.ceil((this.cooldownUntil - now) / 60000))
            throw new StockApiError('rate-limited', `Unsplash 接口限流中，请约 ${String(waitMinutes)} 分钟后再试`)
        }
        this.trimWindow(now)
        const limit = getZhaiConfig().stockHourlyLimit
        if (limit > 0 && this.stamps.length >= limit) {
            const earliest = this.stamps[0] ?? now
            const waitMinutes = Math.max(1, Math.ceil((earliest + RATE_WINDOW_MS - now) / 60000))
            throw new StockApiError(
                'rate-limited',
                `本小时调用已达上限（${String(limit)} 次），请约 ${String(waitMinutes)} 分钟后再试或调高 zhai.stock.hourlyLimit`,
            )
        }
        const minInterval = Math.max(0, getZhaiConfig().stockMinIntervalMs)
        const last = this.stamps[this.stamps.length - 1]
        if (last !== undefined && now - last < minInterval) {
            await sleep(minInterval - (now - last))
        }
    }

    /** 清理窗口内过期的时刻 */
    private trimWindow(now: number): void {
        while (this.stamps.length > 0 && now - (this.stamps[0] ?? now) > RATE_WINDOW_MS) {
            this.stamps.shift()
        }
    }

    /**
     * 发一次请求：网络失败与 5xx 退避重试，401/403/429 立即归一。
     * @param maxRetry 额外重试次数，下载计数传 0
     */
    private async send(url: URL, key: string, timeoutMs: number, maxRetry: number): Promise<Response> {
        let attempt = 0
        for (;;) {
            this.trimWindow(Date.now())
            this.stamps.push(Date.now())
            let response: Response
            try {
                response = await fetch(url, {
                    headers: { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' },
                    signal: AbortSignal.timeout(timeoutMs),
                })
            } catch (cause) {
                if (attempt >= maxRetry) {
                    throw new StockApiError('network', `无法连接 Unsplash：${errorText(cause)}`, true)
                }
                await sleep(1000 * 2 ** attempt + Math.floor(Math.random() * 300))
                attempt += 1
                continue
            }
            if (response.ok) {
                return response
            }
            if (response.status === 401) {
                throw new StockApiError('invalid-key', 'Unsplash Access Key 无效或已被撤销，请重新填写')
            }
            if (response.status === 403) {
                throw new StockApiError('forbidden', 'Unsplash 应用没有该接口权限，请检查应用审核状态')
            }
            if (response.status === 429) {
                const waitSeconds = readRetryAfter(response.headers)
                this.cooldownUntil = Date.now() + waitSeconds * 1000
                throw new StockApiError('rate-limited', `触发 Unsplash 限流，请 ${String(waitSeconds)} 秒后再试`)
            }
            if (response.status >= 500 && attempt < maxRetry) {
                await sleep(1000 * 2 ** attempt + Math.floor(Math.random() * 300))
                attempt += 1
                continue
            }
            throw new StockApiError('server', `Unsplash 返回 HTTP ${String(response.status)}`, true)
        }
    }
}

/** 由 content-type 推扩展名：无法识别按 jpg 处理 */
function readExtension(contentType: string): string {
    const normalized = contentType.toLowerCase()
    if (normalized.includes('png')) {
        return 'png'
    }
    if (normalized.includes('webp')) {
        return 'webp'
    }
    if (normalized.includes('gif')) {
        return 'gif'
    }
    return 'jpg'
}
