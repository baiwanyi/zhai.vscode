/**
 * 微博图片代理：新浪图床按 Referer 放行，Webview 直连（源为 vscode-webview://）会被拒图。
 * 由宿主按浏览器口径补全请求头取回图片，落本地缓存后再签发 Webview 可访问的地址。
 * 复用约定：地址先经 normalizeWeiboImageUrl 收窄，只代理白名单域名；缓存按 URL 哈希命名，命中即零网络。
 * 关键约束：请求头必须与浏览器一致（Referer/Accept/Sec-Fetch-*）；401/403 时带登录 Cookie 重试一次；
 * 取图按「代理 → 直连（强制 IPv4，6s 连接超时，失败重试一次）→ 内置 fetch」逐级降级；
 * 同时下载数受闸门限制，避免几十个连接同时打出去把本地 NAT 与图床都拖到超时；
 * 超过 24MB 的长图自动改用 bmiddle 缩略图，仍超限才放弃；内容类型缺失按魔数识别；失败不落盘。
 */
import * as crypto from 'node:crypto'
import * as dns from 'node:dns'
import * as fs from 'node:fs/promises'
import * as http from 'node:http'
import * as https from 'node:https'
import * as path from 'node:path'
import * as tls from 'node:tls'
import { logger } from '@modules/common/logger'
import { WEIBO_WEB_USER_AGENT } from './webClient'
import { buildMiddleImageUrl, normalizeWeiboImageUrl } from './webTimeline'

/** 图片请求必须带官网 Referer：图床据此判断来源 */
const WEIBO_REFERER = 'https://weibo.com/'

/** 单张上限：超长竖图可能很大，超过该体积改取 bmiddle 缩略图 */
const MAX_IMAGE_BYTES = 24 * 1024 * 1024

/** 同时下载数：一页几十张图同时发起会把本地连接表与图床限流一起打满 */
const MAX_CONCURRENT_DOWNLOADS = 4

/** 连接超时：undici 默认要 10s 才报错，这里收到 6s，快速暴露不可达并进入下一级 */
const CONNECT_TIMEOUT_MS = 6000

/** 读取超时：图片比接口响应慢，但仍要防止连接挂死 */
const DOWNLOAD_TIMEOUT_MS = 20_000

/** 直连失败后的重试间隔：瞬时丢包在移动网络与代理切换时很常见 */
const DIRECT_RETRY_DELAY_MS = 300

/** 缓存文件上限与清理目标：超出后按修改时间删旧，避免缓存无限增长 */
const MAX_CACHE_FILES = 800
const PRUNE_TARGET_FILES = 600

/** 触发清理的写入间隔：不必每次写入都扫目录 */
const PRUNE_INTERVAL_WRITES = 40

/** 与浏览器抓包一致的请求头：图床与 CDN 会按来源与抓取上下文判断 */
const BASE_HEADERS: Readonly<Record<string, string>> = {
    Referer: WEIBO_REFERER,
    'User-Agent': WEIBO_WEB_USER_AGENT,
    Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Sec-Fetch-Dest': 'image',
    'Sec-Fetch-Mode': 'no-cors',
    'Sec-Fetch-Site': 'cross-site',
    Priority: 'u=1, i',
}

/** 允许缓存的内容类型与扩展名：只收静态位图，SVG 等可携带脚本的类型一律拒绝 */
const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/pjpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
    'image/x-ms-bmp': 'bmp',
}

/** 命中查找的扩展名顺序：与下载时可能产生的后缀一致 */
const CACHE_EXTENSIONS = ['jpg', 'png', 'gif', 'webp', 'bmp'] as const

/** 回传 Webview 的单张上限（原始字节）：超过后不内联，交给前端显示占位 */
const INLINE_MAX_BYTES = 4 * 1024 * 1024

/** 扩展名 → MIME：缓存文件按魔数或内容类型落盘，这里只做回填 */
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
    jpg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
}

/**
 * 把缓存文件读成 data URI 回传。
 * 关键约束：Webview 里直接放本地文件依赖 localResourceRoots 与 cspSource 双放行，
 * 远程开发、缓存目录不在扩展目录下等场景容易 ERR_ACCESS_DENIED；data: 已在 CSP 白名单内，
 * 不依赖任何路径授权，且图片普遍在几百 KB 以内，内联成本可控。
 */
export async function readImageAsDataUrl(
    filePath: string,
    maxBytes: number = INLINE_MAX_BYTES,
): Promise<string | null> {
    try {
        const info = await fs.stat(filePath)
        if (!info.isFile() || info.size === 0 || info.size > maxBytes) {
            return null
        }
        const buffer = await fs.readFile(filePath)
        return buildImageDataUrl(buffer, path.extname(filePath).slice(1))
    } catch {
        return null
    }
}

/** 拼 data URI：未知扩展名按 jpeg 兜底，避免浏览器拒整条图片 */
export function buildImageDataUrl(buffer: Buffer, extension: string): string {
    const mime = MIME_BY_EXTENSION[extension.toLowerCase()] ?? 'image/jpeg'
    return `data:${mime};base64,${buffer.toString('base64')}`
}

/** 登录 Cookie 读取器：部分图床或微博域图片需要会话，403 时带上重试 */
export type WeiboCookieReader = () => Promise<string | undefined>

/** 图片代理：对外暴露「远程地址 → 本地路径」，并在面板关闭时释放连接池 */
export interface WeiboMediaProxy {
    /** 解析图片为本地缓存路径；失败返回 null，调用方据此回退占位 */
    resolve(imageUrl: string): Promise<string | null>
    /** 释放直连 agent 的 keep-alive 连接 */
    dispose(): void
}

/** 代理构造参数：代理地址来自 VS Code 的 http.proxy 或环境变量 */
export interface WeiboMediaProxyOptions {
    cacheDir: string
    readCookie?: WeiboCookieReader
    /** 代理地址：给出时优先走 CONNECT 隧道 */
    proxyUrl?: URL | null
    /** 代理与直连是否校验证书：VS Code 的 http.proxyStrictSSL 关闭时放开 */
    isStrictSsl?: boolean
}

/** 一次取图结果：状态码、内容类型与响应体统一形态，供三条通道产出 */
interface LoadedImage {
    status: number
    contentType: string | null
    body: Buffer
    /** 累计体积超限：body 已截断，调用方据此降级到缩略图 */
    isOverLimit: boolean
}

/** 日志脱敏：只保留主机与前 60 字符路径，查询串里可能含签名 */
function describeImageUrl(imageUrl: string): string {
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

/** 按文件头识别格式：内容类型缺失或为 octet-stream 时用它兜底 */
export function sniffImageExtension(buffer: Buffer): string | null {
    if (buffer.length < 12) {
        return null
    }
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return 'jpg'
    }
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
        return 'png'
    }
    if (buffer.subarray(0, 3).toString('latin1') === 'GIF') {
        return 'gif'
    }
    if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') {
        return 'webp'
    }
    if (buffer[0] === 0x42 && buffer[1] === 0x4d) {
        return 'bmp'
    }
    return null
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

/** 组装请求头：仅在图床要求会话时附 Cookie */
function buildRequestHeaders(cookie: string | undefined): Record<string, string> {
    const headers: Record<string, string> = { ...BASE_HEADERS }
    if (cookie !== undefined && cookie.length > 0) {
        headers.Cookie = cookie
    }
    return headers
}

/** 长图降级：换成中等尺寸版本；地址没有尺寸目录时返回 null，表示无法降级 */
function buildFallbackImageUrl(imageUrl: string): string | null {
    const middleUrl = buildMiddleImageUrl(imageUrl)
    return middleUrl === imageUrl ? null : middleUrl
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

/** 兜底通道：内置 fetch（undici），网络环境正常时最短路径 */
async function loadWithFetch(imageUrl: string, cookie: string | undefined): Promise<LoadedImage> {
    const response = await fetch(imageUrl, {
        method: 'GET',
        headers: buildRequestHeaders(cookie),
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    })
    const body = Buffer.from(await response.arrayBuffer())
    return {
        status: response.status,
        contentType: response.headers.get('content-type'),
        body,
        isOverLimit: body.byteLength > MAX_IMAGE_BYTES,
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

/**
 * 四级取图：代理（若配置）→ 内置 fetch（连接池复用，首选）→ IPv4 优先后再 fetch → 直连 agent。
 * 顺序依据实测：undici 的连接复用比每次新建 TLS 更稳，直连作为最后兜底。
 */
async function loadImage(
    imageUrl: string,
    cookie: string | undefined,
    options: Pick<WeiboMediaProxyOptions, 'proxyUrl' | 'isStrictSsl'>,
    directAgent: https.Agent,
): Promise<LoadedImage | null> {
    let target: URL
    try {
        target = new URL(imageUrl)
    } catch {
        return null
    }
    const headers = buildRequestHeaders(cookie)
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

/** 创建图片代理：cacheDir 通常落在 globalStorage 下 */
export function createWeiboMediaProxy(options: WeiboMediaProxyOptions): WeiboMediaProxy {
    const { cacheDir, readCookie } = options
    /** 直连连接池：固定 IPv4、复用连接，避免每张图都新建 TLS 握手 */
    const directAgent = new https.Agent({
        keepAlive: true,
        maxSockets: MAX_CONCURRENT_DOWNLOADS,
        family: 4,
    })
    /** 进行中的下载：同一 URL 并发请求只下载一次 */
    const inflight = new Map<string, Promise<string | null>>()
    /** 下载闸门：控制同时在建的连接数 */
    const waiters: Array<() => void> = []
    let activeDownloads = 0
    let writeCount = 0

    /** 取一个下载名额：满员时排队，被唤醒即视为名额已转交 */
    async function acquireSlot(): Promise<void> {
        if (activeDownloads < MAX_CONCURRENT_DOWNLOADS) {
            activeDownloads += 1
            return
        }
        await new Promise<void>((resolve) => {
            waiters.push(resolve)
        })
    }

    /** 归还名额：有排队者就直接转交，计数不变 */
    function releaseSlot(): void {
        const next = waiters.shift()
        if (next !== undefined) {
            next()
            return
        }
        activeDownloads -= 1
    }

    /** 命中查找：同一 URL 哈希可能以不同后缀存在（历史上内容类型变化） */
    async function findCached(stem: string): Promise<string | null> {
        for (const ext of CACHE_EXTENSIONS) {
            const candidate = path.join(cacheDir, `${stem}.${ext}`)
            const isExists = await fs.access(candidate).then(
                () => true,
                () => false,
            )
            if (isExists) {
                return candidate
            }
        }
        return null
    }

    /** 按修改时间删旧：只在文件数超限时触发，失败不影响主流程 */
    async function prune(): Promise<void> {
        try {
            const names = await fs.readdir(cacheDir)
            if (names.length <= MAX_CACHE_FILES) {
                return
            }
            const entries = await Promise.all(
                names.map(async (name) => {
                    const full = path.join(cacheDir, name)
                    const info = await fs.stat(full)
                    return { full, mtime: info.mtimeMs }
                }),
            )
            entries.sort((left, right) => left.mtime - right.mtime)
            const removable = entries.slice(0, entries.length - PRUNE_TARGET_FILES)
            await Promise.all(removable.map((entry) => fs.rm(entry.full, { force: true })))
        } catch {
            // 清理属尽力而为：缓存目录被占用或权限不足时保留现状
        }
    }

    /** 取一次图，401/403 时带 Cookie 重试一次 */
    async function loadOnce(imageUrl: string): Promise<LoadedImage | null> {
        let response = await loadImage(imageUrl, undefined, options, directAgent)
        if (response !== null && (response.status === 401 || response.status === 403)) {
            const cookie = await readCookie?.()
            if (cookie !== undefined && cookie.length > 0) {
                response = await loadImage(imageUrl, cookie, options, directAgent)
            }
        }
        return response
    }

    /** 下载并落盘：任何异常都收敛成 null，并记录可诊断的原因 */
    async function download(imageUrl: string, stem: string): Promise<string | null> {
        await acquireSlot()
        try {
            let loaded = await loadOnce(imageUrl)
            // 超长图改取 bmiddle 小尺寸版本：同一对象，体积通常只有几十分之一
            if (loaded !== null && loaded.isOverLimit) {
                const fallbackUrl = buildFallbackImageUrl(imageUrl)
                if (fallbackUrl !== null) {
                    logger.warn(`微博图片超过体积上限，改取中等尺寸：${describeImageUrl(imageUrl)}`)
                    loaded = await loadOnce(fallbackUrl)
                }
            }
            if (loaded === null) {
                return null
            }
            if (loaded.isOverLimit) {
                logger.warn(`微博图片体积超限已跳过：${describeImageUrl(imageUrl)}`)
                return null
            }
            if (loaded.status < 200 || loaded.status >= 300) {
                logger.warn(`微博图片下载失败：${describeImageUrl(imageUrl)}（HTTP ${String(loaded.status)}）`)
                return null
            }
            if (loaded.body.byteLength === 0) {
                logger.warn(`微博图片响应为空：${describeImageUrl(imageUrl)}`)
                return null
            }
            const ext = readExtension(loaded.contentType, loaded.body)
            if (ext === null) {
                logger.warn(
                    `微博图片格式不支持：${describeImageUrl(imageUrl)}（content-type: ${loaded.contentType ?? '缺失'}）`,
                )
                return null
            }
            await fs.mkdir(cacheDir, { recursive: true })
            const target = path.join(cacheDir, `${stem}.${ext}`)
            const temp = `${target}.tmp`
            await fs.writeFile(temp, loaded.body)
            await fs.rename(temp, target)
            writeCount += 1
            if (writeCount % PRUNE_INTERVAL_WRITES === 0) {
                await prune()
            }
            return target
        } catch (error) {
            logger.warn(
                `微博图片处理失败：${describeImageUrl(imageUrl)}（${error instanceof Error ? error.message : String(error)}）`,
            )
            return null
        } finally {
            releaseSlot()
        }
    }

    return {
        resolve: async (imageUrl: string): Promise<string | null> => {
            const url = normalizeWeiboImageUrl(imageUrl)
            if (url === null) {
                logger.warn(`微博图片地址不在白名单：${describeImageUrl(imageUrl)}`)
                return null
            }
            const stem = crypto.createHash('sha256').update(url).digest('hex').slice(0, 32)
            const cached = await findCached(stem)
            if (cached !== null) {
                return cached
            }
            const existing = inflight.get(url)
            if (existing !== undefined) {
                return existing
            }
            const task = download(url, stem).finally(() => {
                inflight.delete(url)
            })
            inflight.set(url, task)
            return task
        },
        dispose: (): void => {
            directAgent.destroy()
        },
    }
}
