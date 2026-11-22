/**
 * 图片下载通道：代理隧道、内置 fetch 与 IPv4 直连三级降级，统一产出状态码与字节。
 * 复用约定：请求头按浏览器口径组装，会话 Cookie 只发往微博主站域；通道内部不落盘、不校验业务语义，
 * 缓存与重定向策略由 mediaProxy 决定。
 * 关键约束：内置 fetch 显式关闭自动重定向（每一跳都要重新过白名单）；
 * 直连 agent 固定 IPv4 并复用连接；读体限长，超限立即取消上游读取。
 */
import * as dns from 'node:dns'
import * as http from 'node:http'
import * as https from 'node:https'
import * as tls from 'node:tls'
import { logger } from '@modules/common/logger'
import { MIME_EXTENSIONS, sniffImageExtension } from './imageData'
import { WEIBO_WEB_REFERER } from '../endpoints'
import { WEIBO_WEB_USER_AGENT } from '../transport/httpClient'

/** 单张上限：超长竖图可能很大，超过该体积改取 bmiddle 缩略图 */
const MAX_IMAGE_BYTES = 24 * 1024 * 1024

/** 连接超时：undici 默认要 10s 才报错，这里收到 6s，快速暴露不可达并进入下一级 */
const CONNECT_TIMEOUT_MS = 6000

/** 读取超时：图片比接口响应慢，但仍要防止连接挂死 */
const DOWNLOAD_TIMEOUT_MS = 20_000

/** 直连失败后的重试间隔：瞬时丢包在移动网络与代理切换时很常见 */
const DIRECT_RETRY_DELAY_MS = 300

/** 与浏览器抓包一致的请求头：图床与 CDN 会按来源与抓取上下文判断 */
const BASE_HEADERS: Readonly<Record<string, string>> = {
    Referer: WEIBO_WEB_REFERER,
    'User-Agent': WEIBO_WEB_USER_AGENT,
    Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Sec-Fetch-Dest': 'image',
    'Sec-Fetch-Mode': 'no-cors',
    'Sec-Fetch-Site': 'cross-site',
    Priority: 'u=1, i',
}

/** 一次取图结果：状态码、内容类型、重定向目标与响应体统一形态，供三条通道产出 */
export interface LoadedImage {
    status: number
    contentType: string | null
    /** 3xx 响应的 Location：官方下载端点会 302 到图床，直连通道不会自动跟随 */
    location: string | null
    body: Buffer
    /** 累计体积超限：body 已截断，调用方据此降级到缩略图 */
    isOverLimit: boolean
}

/** 日志脱敏：只保留主机与前 60 字符路径，查询串里可能含签名 */
export function describeImageUrl(imageUrl: string): string {
    try {
        const parsed = new URL(imageUrl)
        return `${parsed.host}${parsed.pathname.slice(0, 60)}`
    } catch {
        return '非法地址'
    }
}

/** 读取错误码：Node 的底层错误把真正原因放在 cause 上，不展开就只剩「fetch failed」 */
function readErrorCode(error: Error): string | null {
    const value: unknown = (error as { code?: unknown }).code
    return typeof value === 'string' ? value : null
}

/** 归一网络错误文案：带上 cause 的 code / message，便于定位 DNS、TLS 或连接被拒 */
function describeNetworkError(error: unknown): string {
    if (!(error instanceof Error)) {
        return String(error)
    }
    const cause: unknown = (error as { cause?: unknown }).cause
    if (cause instanceof Error) {
        const code = readErrorCode(cause)
        return code === null ? `${error.message} / ${cause.message}` : `${error.message} / ${code}`
    }
    const code = readErrorCode(error)
    return code === null ? error.message : `${error.message} / ${code}`
}

/** 取扩展名：先信任内容类型，缺失或不认识时按魔数嗅探 */
function readExtension(contentType: string | null, buffer: Buffer): string | null {
    const mime = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
    return MIME_EXTENSIONS[mime] ?? sniffImageExtension(buffer)
}

/** 归一响应头取值：数组只取第一个 */
function readHeaderValue(value: string | string[] | undefined): string | null {
    if (Array.isArray(value)) {
        return value[0] ?? null
    }
    return value ?? null
}

/** 会话凭证适用域：微博登录态只对主站及其子域有效，跨站发送等于把 Cookie 交给第三方域 */
const WEIBO_SESSION_HOSTS = ['weibo.com'] as const

/** 目标主机是否属于会话域：精确相等或点分后缀，避免 sub.weibo.com.evil.com 绕过 */
function isWeiboSessionHost(hostname: string): boolean {
    const host = hostname.toLowerCase()
    return WEIBO_SESSION_HOSTS.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
}

/**
 * 组装请求头：仅在图床要求会话、且目标确实是微博主站域时附 Cookie。
 * 关键约束：图床 CDN（sinaimg.cn / weibo.cn）不接收会话凭证，否则一次 403 重试就能把登录态交给第三方域。
 */
export function buildRequestHeaders(target: string, cookie: string | undefined): Record<string, string> {
    const headers: Record<string, string> = { ...BASE_HEADERS }
    if (cookie === undefined || cookie.length === 0) {
        return headers
    }
    try {
        if (isWeiboSessionHost(new URL(target).hostname)) {
            headers.Cookie = cookie
        }
    } catch {
        // 地址不可解析时不附 Cookie：宁可这次取图失败，也不把凭证发到未确认的主机
    }
    return headers
}

/** 收集响应体：超限只标记不抛错，交由调用方决定是否改取缩略图 */
function collectResponse(response: http.IncomingMessage, request: http.ClientRequest): Promise<LoadedImage> {
    return new Promise<LoadedImage>((resolve, reject) => {
        const chunks: Buffer[] = []
        let total = 0
        let isOverLimit = false
        response.on('data', (chunk: Buffer) => {
            if (isOverLimit) {
                return
            }
            total += chunk.length
            if (total > MAX_IMAGE_BYTES) {
                isOverLimit = true
                chunks.length = 0
                return
            }
            chunks.push(chunk)
        })
        response.on('end', () => {
            resolve({
                status: response.statusCode ?? 0,
                contentType: readHeaderValue(response.headers['content-type']),
                location: readHeaderValue(response.headers.location),
                body: Buffer.concat(chunks),
                isOverLimit,
            })
        })
        response.on('error', reject)
        request.on('error', reject)
    })
}

/** 直连通道：agent 固定 IPv4 并复用连接，减少每次新建 TCP/TLS 的握手开销 */
function loadDirect(
    target: URL,
    headers: Record<string, string>,
    isStrictSsl: boolean,
    agent: https.Agent,
): Promise<LoadedImage> {
    return new Promise<LoadedImage>((resolve, reject) => {
        const request = https.request(
            target,
            {
                method: 'GET',
                headers,
                agent,
                timeout: CONNECT_TIMEOUT_MS,
                rejectUnauthorized: isStrictSsl,
            },
            (response) => {
                void collectResponse(response, request).then(resolve, reject)
            },
        )
        request.on('timeout', () => {
            request.destroy(new Error('直连超时'))
        })
        request.on('error', reject)
        request.end()
    })
}

/** 代理通道：先 CONNECT 建隧道，再在隧道里做 TLS 握手与请求 */
function loadViaProxy(
    target: URL,
    headers: Record<string, string>,
    proxy: URL,
    isStrictSsl: boolean,
): Promise<LoadedImage> {
    return new Promise<LoadedImage>((resolve, reject) => {
        const authorization =
            proxy.username.length > 0
                ? `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')}`
                : null
        const connectHeaders: Record<string, string> = { Host: `${target.hostname}:443` }
        if (authorization !== null) {
            connectHeaders['Proxy-Authorization'] = authorization
        }
        const connectRequest = http.request({
            host: proxy.hostname,
            port: proxy.port.length > 0 ? Number(proxy.port) : 80,
            method: 'CONNECT',
            path: `${target.hostname}:443`,
            headers: connectHeaders,
            timeout: CONNECT_TIMEOUT_MS,
        })
        connectRequest.on('connect', (response, socket) => {
            if (response.statusCode !== 200) {
                socket.destroy()
                reject(new Error(`代理 CONNECT 被拒：HTTP ${String(response.statusCode ?? 0)}`))
                return
            }
            const secureSocket = tls.connect({
                socket,
                servername: target.hostname,
                rejectUnauthorized: isStrictSsl,
            })
            // 复用已建好的隧道：给本次请求一个只回这条 socket 的一次性 agent
            const agent = new https.Agent({ keepAlive: false })
            agent.createConnection = (): tls.TLSSocket => secureSocket
            const request = https.request(
                target,
                { method: 'GET', headers, agent, timeout: DOWNLOAD_TIMEOUT_MS },
                (res) => {
                    void collectResponse(res, request).then(resolve, reject)
                },
            )
            request.on('timeout', () => {
                request.destroy(new Error('代理读取超时'))
            })
            request.on('error', reject)
            request.end()
        })
        connectRequest.on('timeout', () => {
            connectRequest.destroy(new Error('代理连接超时'))
        })
        connectRequest.on('error', reject)
        connectRequest.end()
    })
}

/** 流式读取响应体并限长：超过上限立即取消上游读取，避免大文件把内存与带宽吃满 */
async function readBodyLimited(response: Response): Promise<{ body: Buffer; isOverLimit: boolean }> {
    const stream = response.body
    if (stream === null) {
        return { body: Buffer.alloc(0), isOverLimit: false }
    }
    const reader = stream.getReader()
    const chunks: Buffer[] = []
    let total = 0
    let isOverLimit = false
    try {
        for (;;) {
            const { done: isDone, value } = await reader.read()
            if (isDone) {
                break
            }
            total += value.byteLength
            if (total > MAX_IMAGE_BYTES) {
                isOverLimit = true
                await reader.cancel()
                break
            }
            chunks.push(Buffer.from(value))
        }
    } finally {
        try {
            reader.releaseLock()
        } catch {
            // 取消后锁可能已释放：这里只保证不抛错
        }
    }
    return isOverLimit ? { body: Buffer.alloc(0), isOverLimit } : { body: Buffer.concat(chunks), isOverLimit }
}

/**
 * 兜底通道：内置 fetch（undici），网络环境正常时最短路径。
 * 关键约束：显式 redirect: 'manual'——自动跟随会让上游用一个 302 把请求带去内网或任意主机，
 * 绕过 normalizeWeiboImageUrl 的白名单；重定向交给 mediaProxy 的 loadFollowingRedirects 逐跳校验。
 */
async function loadWithFetch(imageUrl: string, cookie: string | undefined): Promise<LoadedImage> {
    const response = await fetch(imageUrl, {
        method: 'GET',
        headers: buildRequestHeaders(imageUrl, cookie),
        redirect: 'manual',
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    })
    const status = response.status
    const location = response.headers.get('location')
    // 3xx 只需地址，不必读重定向页正文：既省流量，也避免把上游错误页当图片解析
    const payload =
        status >= 300 && status < 400 ? { body: Buffer.alloc(0), isOverLimit: false } : await readBodyLimited(response)
    return {
        status,
        contentType: response.headers.get('content-type'),
        location,
        body: payload.body,
        isOverLimit: payload.isOverLimit,
    }
}

/** 直连失败重试一次：瞬时丢包不必立刻降级到更慢的通道 */
async function loadDirectWithRetry(
    target: URL,
    headers: Record<string, string>,
    isStrictSsl: boolean,
    agent: https.Agent,
): Promise<LoadedImage> {
    try {
        return await loadDirect(target, headers, isStrictSsl, agent)
    } catch (error) {
        logger.warn(
            `微博图片 direct 首次失败，稍后重试：${describeImageUrl(target.toString())}（${describeNetworkError(error)}）`,
        )
        await new Promise<void>((resolve) => {
            setTimeout(resolve, DIRECT_RETRY_DELAY_MS)
        })
        return loadDirect(target, headers, isStrictSsl, agent)
    }
}

/** 让内置 fetch 也优先解析 IPv4：双栈环境下 IPv6 不可达会拖到 10s 连接超时 */
function preferIpv4(): void {
    try {
        dns.setDefaultResultOrder('ipv4first')
    } catch {
        // 老版本 Node 不认识该选项：保持默认顺序
    }
}

/** 通道参数：由 mediaProxy 的构造选项裁剪而来，避免本模块反向依赖代理类型 */
export interface ImageNetworkOptions {
    proxyUrl?: URL | null
    isStrictSsl?: boolean
}

/**
 * 四级取图：代理（若配置）→ 内置 fetch（连接池复用，首选）→ IPv4 优先后再 fetch → 直连 agent。
 * 顺序依据实测：undici 的连接复用比每次新建 TLS 更稳，直连作为最后兜底。
 */
export async function loadImage(
    imageUrl: string,
    cookie: string | undefined,
    options: ImageNetworkOptions,
    directAgent: https.Agent,
): Promise<LoadedImage | null> {
    let target: URL
    try {
        target = new URL(imageUrl)
    } catch {
        return null
    }
    const headers = buildRequestHeaders(imageUrl, cookie)
    const isStrictSsl = options.isStrictSsl ?? true
    const proxyUrl = options.proxyUrl ?? null

    if (proxyUrl !== null) {
        try {
            return await loadViaProxy(target, headers, proxyUrl, isStrictSsl)
        } catch (error) {
            logger.warn(`微博图片 proxy 失败：${describeImageUrl(imageUrl)}（${describeNetworkError(error)}）`)
        }
    }
    try {
        return await loadWithFetch(imageUrl, cookie)
    } catch (error) {
        logger.warn(`微博图片 fetch 失败：${describeImageUrl(imageUrl)}（${describeNetworkError(error)}）`)
    }
    preferIpv4()
    try {
        return await loadWithFetch(imageUrl, cookie)
    } catch (error) {
        logger.warn(`微博图片 fetch(ipv4) 失败：${describeImageUrl(imageUrl)}（${describeNetworkError(error)}）`)
    }
    try {
        return await loadDirectWithRetry(target, headers, isStrictSsl, directAgent)
    } catch (error) {
        logger.warn(`微博图片 direct 失败：${describeImageUrl(imageUrl)}（${describeNetworkError(error)}）`)
        return null
    }
}

/** 供代理层判断内容类型：内容类型缺失时按魔数兜底 */
export function resolveImageExtension(contentType: string | null, buffer: Buffer): string | null {
    return readExtension(contentType, buffer)
}
