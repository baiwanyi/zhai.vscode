/**
 * 微博视频中转：视频 CDN 校验 Referer，Webview 无法自定义请求头，故由宿主起一个只监听 127.0.0.1 的
 * 本地 HTTP 服务，把 CDN 的字节流按需透传给 <video>，不落盘、不整段缓冲。
 * 复用约定：地址先经 normalizeWeiboVideoUrl 收窄，只中转白名单主机；Range / Content-Range 原样透传，
 * 播放器可边下边播、可拖动进度。
 * 关键约束：只接受 GET / HEAD 与 `/video?url=` 路径；端口由系统分配、仅绑回环，面板关闭即关服务；
 * 请求必须带启动时生成的随机令牌，否则 403——挡的是本机其它进程随手复用这条带 Referer 的通道；
 * 上游非 2xx 时把状态码透传给播放器，不静默返回空体；客户端断开时立刻取消上游读取，避免白跑流量；
 * 内置 fetch 显式关闭自动重定向（redirect: manual），每一跳都重新过白名单，防止被上游带去内网；
 * 非媒体类型（text/html、application/json）一律 502，避免把上游错误页当中转内容回吐；
 * 同时转码数受闸门限制，超出时直接回退原样转发（可能无声），不让 ffmpeg 进程无限叠加。
 */
import * as crypto from 'node:crypto'
import { once } from 'node:events'
import * as http from 'node:http'
import { logger } from '@modules/common/logger'
import { resolveFfmpeg, serveTranscoded } from './videoTranscode'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { WEIBO_WEB_REFERER } from '../endpoints'
import { normalizeWeiboVideoUrl } from '../timeline/media'
import { WEIBO_WEB_USER_AGENT } from '../transport/httpClient'

/** 视频中转路径：只有这一个入口，其余路径一律 404 */
const VIDEO_ROUTE = '/video'

/** 访问令牌的查询参数名：拼在本地播放地址里，Webview 无需额外逻辑 */
const TOKEN_PARAM = 't'

/** 访问令牌字节数：128 位随机串，本机进程无法猜出 */
const TOKEN_BYTES = 16

/** 只绑回环地址：中转服务不对外暴露，端口由系统分配 */
const LOOPBACK_HOST = '127.0.0.1'

/**
 * 上游首字节超时：定时器在拿到响应头后立即清除，信号只覆盖建连与首字节，
 * 长视频的持续传输不受影响（AbortSignal 若作用于整个响应，超过 5 分钟的视频会被掐断）。
 */
const CONNECT_TIMEOUT_MS = 60_000

/** 允许跟随的重定向跳数：正常只有一跳，超限直接放弃 */
const MAX_REDIRECTS = 3

/** 明确的非媒体类型：命中即拒绝，避免把上游错误页当作中转内容回吐给播放器 */
const NON_MEDIA_TYPES = ['text/html', 'application/json'] as const

/** 本地播放地址：seekable 为 false 时播放器应禁用进度拖动 */
export interface WeiboLocalVideo {
    url: string
    seekable: boolean
}

/** 中转服务：把远程视频地址换成本地可播地址，并提供关闭入口 */
export interface WeiboVideoServer {
    /** 生成本地播放地址；远程地址不在白名单时返回 null */
    toLocalUrl(remoteUrl: string): WeiboLocalVideo | null
    /** 关闭监听并断开所有连接 */
    dispose(): void
}

/** 上游请求头：与浏览器播放视频时一致，Referer 是关键的一项 */
function buildUpstreamHeaders(range: string | undefined): Record<string, string> {
    const headers: Record<string, string> = {
        Referer: WEIBO_WEB_REFERER,
        'User-Agent': WEIBO_WEB_USER_AGENT,
        Accept: 'video/mp4,video/*;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Sec-Fetch-Dest': 'video',
        'Sec-Fetch-Mode': 'no-cors',
        'Sec-Fetch-Site': 'cross-site',
    }
    if (range !== undefined && range.length > 0) {
        headers.Range = range
    }
    return headers
}

/** 透传上游响应头：只转发播放器需要的几项，避免把 CDN 的 set-cookie 之类带到本地 */
function buildDownstreamHeaders(upstream: Response): Record<string, string> {
    const headers: Record<string, string> = {
        'Content-Type': upstream.headers.get('content-type') ?? 'video/mp4',
        'Cache-Control': 'no-store',
        'Accept-Ranges': 'bytes',
    }
    const length = upstream.headers.get('content-length')
    if (length !== null) {
        headers['Content-Length'] = length
    }
    const contentRange = upstream.headers.get('content-range')
    if (contentRange !== null) {
        headers['Content-Range'] = contentRange
    }
    return headers
}

/** 把上游字节流写给播放器：背压交给 response.write 的返回值控制，客户端断开即取消读取 */
async function pipeBody(upstream: Response, response: ServerResponse): Promise<void> {
    const body = upstream.body
    if (body === null) {
        response.end()
        return
    }
    const reader = body.getReader()
    try {
        for (;;) {
            const { done: isDone, value } = await reader.read()
            if (isDone) {
                break
            }
            if (!response.write(Buffer.from(value))) {
                await once(response, 'drain')
            }
        }
        response.end()
    } catch (error) {
        logger.warn(`微博视频中转中断：${error instanceof Error ? error.message : String(error)}`)
        response.destroy()
    } finally {
        reader.releaseLock()
    }
}

/**
 * 取上游响应：自带重定向处理，每一跳重新过白名单。
 * 关键约束：内置 fetch 默认自动跟随重定向，上游一个 302 就能把请求带去内网或任意主机；
 * 这里强制 redirect: 'manual'，跳数与目标都由本函数校验。
 * 首字节超时用定时器实现，拿到响应头即清除——AbortSignal.timeout 会覆盖整个响应，长视频会被中途掐断。
 */
export async function fetchUpstream(
    target: string,
    method: string,
    range: string | undefined,
): Promise<Response | null> {
    let current = target
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
        const allowed = normalizeWeiboVideoUrl(current)
        if (allowed === null) {
            logger.warn(`微博视频中转放弃跳转：目标不在白名单内（第 ${String(hop)} 跳）`)
            return null
        }
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS)
        try {
            const upstream = await fetch(allowed, {
                method,
                headers: buildUpstreamHeaders(range),
                redirect: 'manual',
                signal: controller.signal,
            })
            clearTimeout(timer)
            if (upstream.status < 300 || upstream.status >= 400) {
                return upstream
            }
            const location = upstream.headers.get('location')
            await upstream.body?.cancel()
            if (location === null) {
                return null
            }
            current = new URL(location, allowed).toString()
        } catch (error) {
            clearTimeout(timer)
            logger.warn(`微博视频中转取流失败：${error instanceof Error ? error.message : String(error)}`)
            return null
        }
    }
    logger.warn('微博视频中转重定向次数超限，已放弃')
    return null
}

/** 是否为明确的非媒体类型：命中即拒绝，避免把上游错误页当中转内容回吐 */
function isNonMediaType(contentType: string | null): boolean {
    const mime = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
    return NON_MEDIA_TYPES.some((type) => mime === type)
}

/** 处理一次播放请求：校验令牌、路径与地址，透传 Range，流式回写 */
async function handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
    port: number,
    token: string,
): Promise<void> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405).end()
        return
    }
    const url = new URL(request.url ?? '/', `http://${LOOPBACK_HOST}:${String(port)}`)
    if (url.pathname !== VIDEO_ROUTE) {
        response.writeHead(404).end()
        return
    }
    // 令牌只挡本机其它进程：服务本身只绑回环，不承担远程鉴权职责
    if (url.searchParams.get(TOKEN_PARAM) !== token) {
        response.writeHead(403).end()
        return
    }
    const target = normalizeWeiboVideoUrl(url.searchParams.get('url') ?? '')
    if (target === null) {
        response.writeHead(400).end()
        return
    }
    // 有 ffmpeg 且转码名额未满就转码音轨（否则 Webview 放不出 AAC），转码失败再退回原样转发
    if (request.method === 'GET' && (await serveTranscoded(target, response))) {
        return
    }
    const upstream = await fetchUpstream(target, request.method, request.headers.range)
    if (upstream === null) {
        response.writeHead(502).end()
        return
    }
    if (upstream.status >= 200 && upstream.status < 300 && isNonMediaType(upstream.headers.get('content-type'))) {
        logger.warn(`微博视频中转拒绝非媒体响应：${upstream.headers.get('content-type') ?? '缺失'}`)
        await upstream.body?.cancel()
        response.writeHead(502).end()
        return
    }
    // 客户端提前断开（切走/换源）才取消上游。
    // 关键约束：必须监听 response 的 close 而不是 request 的——GET 没有请求体，
    // request 的 close 在请求头读完就触发，会把正常播放的流当场掐断。
    response.once('close', () => {
        if (!response.writableEnded) {
            void upstream.body?.cancel()
        }
    })
    response.writeHead(upstream.status, buildDownstreamHeaders(upstream))
    await pipeBody(upstream, response)
}

/** 创建中转服务：端口交给系统分配，只绑回环地址 */
export async function createWeiboVideoServer(): Promise<WeiboVideoServer> {
    let port = 0
    // 每次开面板换一枚令牌：旧面板的地址在服务关闭后本就失效，不必持久化
    const token = crypto.randomBytes(TOKEN_BYTES).toString('hex')
    const server = http.createServer((request, response) => {
        void handleRequest(request, response, port, token)
    })
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, LOOPBACK_HOST, () => {
            resolve()
        })
    })
    const address = server.address()
    port = typeof address === 'object' && address !== null ? address.port : 0
    // 有 ffmpeg 就会转码（输出分片 mp4、不支持 Range），此时播放器只能从头播；
    // 没有 ffmpeg 时原样转发并透传 Range，进度条可以拖动
    const canSeek = (await resolveFfmpeg()) === null

    return {
        toLocalUrl: (remoteUrl: string): WeiboLocalVideo | null => {
            const target = normalizeWeiboVideoUrl(remoteUrl)
            if (target === null || port === 0) {
                return null
            }
            const url = `http://${LOOPBACK_HOST}:${String(port)}${VIDEO_ROUTE}?url=${encodeURIComponent(target)}&${TOKEN_PARAM}=${token}`
            return { url, seekable: canSeek }
        },
        dispose: (): void => {
            server.close()
            server.closeAllConnections()
        },
    }
}
