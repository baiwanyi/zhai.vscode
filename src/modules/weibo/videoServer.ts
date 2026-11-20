/**
 * 微博视频中转：视频 CDN 校验 Referer，Webview 无法自定义请求头，故由宿主起一个只监听 127.0.0.1 的
 * 本地 HTTP 服务，把 CDN 的字节流按需透传给 <video>，不落盘、不整段缓冲。
 * 复用约定：地址先经 normalizeWeiboVideoUrl 收窄，只中转白名单主机；Range / Content-Range 原样透传，
 * 播放器可边下边播、可拖动进度。
 * 关键约束：只接受 GET / HEAD 与 `/video?url=` 路径；端口由系统分配、仅绑回环，面板关闭即关服务；
 * 上游非 2xx 时把状态码透传给播放器，不静默返回空体；客户端断开时立刻取消上游读取，避免白跑流量。
 */
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import * as http from 'node:http'
import { logger } from '@modules/common/logger'
import { WEIBO_WEB_USER_AGENT } from './webClient'
import { normalizeWeiboVideoUrl } from './webTimeline'
import { WEIBO_WEB_REFERER } from './weiboEndpoints'
import type { IncomingMessage, ServerResponse } from 'node:http'

/** 视频中转路径：只有这一个入口，其余路径一律 404 */
const VIDEO_ROUTE = '/video'

/** 上游超时：只覆盖建连与首字节，长视频持续传输不受影响（AbortSignal 作用于整个响应，故给足） */
const UPSTREAM_TIMEOUT_MS = 300_000

/** 中转服务：把远程视频地址换成本地可播地址，并提供关闭入口 */
export interface WeiboVideoServer {
    /** 生成本地播放地址；远程地址不在白名单时返回 null */
    toLocalUrl(remoteUrl: string): string | null
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

/** ffmpeg 探测结果：undefined 表示还没探测，null 表示不可用 */
let ffmpegCommand: string | null | undefined

/**
 * 探测 ffmpeg：VS Code 的 Webview 跑在 Electron 自带的 Chromium 上，那份构建不含 AAC 解码器
 * （microsoft/vscode#167685，官方只保证 Wav / Mp3 / Ogg / Flac），而微博视频音轨全是 AAC，
 * 于是画面能放、声音没有。宿主侧能用 ffmpeg 时就把音轨转成 MP3 再喂给播放器。
 */
async function resolveFfmpeg(): Promise<string | null> {
    if (ffmpegCommand !== undefined) {
        return ffmpegCommand
    }
    ffmpegCommand = await new Promise<string | null>((resolve) => {
        const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-version'], { windowsHide: true })
        child.once('error', () => {
            resolve(null)
        })
        child.once('close', (code) => {
            resolve(code === 0 ? 'ffmpeg' : null)
        })
    })
    return ffmpegCommand
}

/**
 * 转码转发：H.264 直接 copy、音轨转 MP3，输出 fragmented mp4 边转边发，不落盘。
 * 关键约束：先收到首个字节才写响应头，失败时调用方还能回退原样转发；客户端断开即 kill 子进程。
 */
function proxyTranscoded(ffmpeg: string, target: string, response: ServerResponse): Promise<boolean> {
    const child = spawn(
        ffmpeg,
        [
            '-hide_banner',
            '-loglevel',
            'error',
            '-headers',
            `Referer: ${WEIBO_WEB_REFERER}\r\nUser-Agent: ${WEIBO_WEB_USER_AGENT}\r\n`,
            '-i',
            target,
            '-map',
            '0:v:0',
            '-map',
            '0:a:0?',
            '-c:v',
            'copy',
            '-c:a',
            'libmp3lame',
            '-b:a',
            '128k',
            '-movflags',
            'frag_keyframe+empty_moov',
            '-f',
            'mp4',
            'pipe:1',
        ],
        { windowsHide: true },
    )
    return new Promise<boolean>((resolve) => {
        let hasOutput = false
        child.stdout.once('data', () => {
            hasOutput = true
            response.writeHead(200, {
                'Content-Type': 'video/mp4',
                'Cache-Control': 'no-store',
                'Accept-Ranges': 'none',
            })
        })
        child.stdout.on('data', (chunk: Buffer) => {
            if (!response.write(chunk)) {
                child.stdout.pause()
                response.once('drain', () => {
                    child.stdout.resume()
                })
            }
        })
        child.once('error', () => {
            resolve(hasOutput)
        })
        child.once('close', () => {
            if (hasOutput) {
                response.end()
            }
            resolve(hasOutput)
        })
        response.once('close', () => {
            if (!response.writableEnded) {
                child.kill()
            }
        })
    })
}

/** 处理一次播放请求：校验路径与地址，透传 Range，流式回写 */
async function handleRequest(request: IncomingMessage, response: ServerResponse, port: number): Promise<void> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405).end()
        return
    }
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${String(port)}`)
    if (url.pathname !== VIDEO_ROUTE) {
        response.writeHead(404).end()
        return
    }
    const target = normalizeWeiboVideoUrl(url.searchParams.get('url') ?? '')
    if (target === null) {
        response.writeHead(400).end()
        return
    }
    // 有 ffmpeg 就转码音轨（否则 Webview 放不出 AAC），转码失败再退回原样转发
    if (request.method === 'GET') {
        const ffmpeg = await resolveFfmpeg()
        if (ffmpeg !== null) {
            const isServed = await proxyTranscoded(ffmpeg, target, response)
            if (isServed) {
                return
            }
            logger.warn('微博视频转码失败，回退原样转发（可能无声）')
        }
    }
    let upstream: Response
    try {
        upstream = await fetch(target, {
            method: request.method,
            headers: buildUpstreamHeaders(request.headers.range),
            signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        })
    } catch (error) {
        logger.warn(`微博视频中转取流失败：${error instanceof Error ? error.message : String(error)}`)
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
    const server = http.createServer((request, response) => {
        void handleRequest(request, response, port)
    })
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => {
            resolve()
        })
    })
    const address = server.address()
    port = typeof address === 'object' && address !== null ? address.port : 0

    return {
        toLocalUrl: (remoteUrl: string): string | null => {
            const target = normalizeWeiboVideoUrl(remoteUrl)
            if (target === null || port === 0) {
                return null
            }
            return `http://127.0.0.1:${String(port)}${VIDEO_ROUTE}?url=${encodeURIComponent(target)}`
        },
        dispose: (): void => {
            server.close()
            server.closeAllConnections()
        },
    }
}
