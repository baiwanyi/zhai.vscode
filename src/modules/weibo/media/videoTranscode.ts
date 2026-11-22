/**
 * 视频音轨转码：宿主侧探测 ffmpeg，把 AAC 音轨转成 MP3 并输出分片 mp4，边转边发、不落盘。
 * 复用约定：由视频中转服务在 GET 请求上调用，转码结果直接写入传入的 ServerResponse；
 * 转码名额与 ffmpeg 探测结果都在本模块内维护，外部只关心「有没有转出去」。
 * 关键约束：VS Code Webview 的 Chromium 不含 AAC 解码器，不转码则画面正常但无声；
 * 协议白名单限定 http/https/tcp/tls，防止上游 302 把输入指向本地文件；
 * 先收到首个字节才写响应头，失败时调用方还能回退原样转发；客户端断开即 kill 子进程。
 */
import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { logger } from '@modules/common/logger'
import type { ServerResponse } from 'node:http'
import { WEIBO_WEB_REFERER } from '../endpoints'
import { WEIBO_WEB_USER_AGENT } from '../transport/httpClient'

/** 同时转码数：每个 ffmpeg 都是独立进程，超出后回退原样转发 */
const MAX_TRANSCODES = 2

/** ffmpeg 探测结果：undefined 表示还没探测，null 表示不可用；命中时是绝对路径 */
let ffmpegCommand: string | null | undefined

/** 可执行扩展名：Windows 依赖 PATHEXT，其它平台没有扩展名 */
const EXECUTABLE_EXTENSIONS = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : ['']

/** 当前转码中的请求数：超过上限后直接回退原样转发，避免子进程风暴 */
let activeTranscodes = 0

/**
 * 在 PATH 里定位可执行文件的绝对路径，找不到返回 null。
 * 关键约束：定位结果只用于「用绝对路径启动」与「日志可诊断」，
 * 不做白名单校验——ffmpeg 由用户环境提供，宿主不应替用户决定放哪里。
 */
function resolveExecutablePath(command: string): string | null {
    const rawPath = process.env.PATH ?? ''
    for (const dir of rawPath.split(path.delimiter)) {
        if (dir.length > 0) {
            for (const ext of EXECUTABLE_EXTENSIONS) {
                const candidate = path.join(dir, `${command}${ext}`)
                try {
                    if (fs.existsSync(candidate)) {
                        return candidate
                    }
                } catch {
                    // 目录不可读：继续看下一个
                }
            }
        }
    }
    return null
}

/** 读版本号：`-version` 首行形如 `ffmpeg version 6.1.1 ...`，解析失败返回空串 */
function readFfmpegVersion(output: string): string {
    const match = /^ffmpeg version (\S+)/mu.exec(output)
    return match?.[1] ?? ''
}

/**
 * 探测 ffmpeg：VS Code 的 Webview 跑在 Electron 自带的 Chromium 上，那份构建不含 AAC 解码器
 * （microsoft/vscode#167685，官方只保证 Wav / Mp3 / Ogg / Flac），而微博视频音轨全是 AAC，
 * 于是画面能放、声音没有。宿主侧能用 ffmpeg 时就把音轨转成 MP3 再喂给播放器。
 * 关键约束：先解析出绝对路径再启动（避免二次 PATH 解析），并把路径与版本写进日志，
 * 便于排查「同名脚本被 PATH 前置劫持」这类环境问题。
 */
export async function resolveFfmpeg(): Promise<string | null> {
    if (ffmpegCommand !== undefined) {
        return ffmpegCommand
    }
    const executable = resolveExecutablePath('ffmpeg')
    if (executable === null) {
        ffmpegCommand = null
        return null
    }
    ffmpegCommand = await new Promise<string | null>((resolve) => {
        const child = spawn(executable, ['-hide_banner', '-loglevel', 'error', '-version'], { windowsHide: true })
        const chunks: string[] = []
        child.stdout.on('data', (chunk: Buffer) => {
            chunks.push(chunk.toString('utf8'))
        })
        child.once('error', () => {
            resolve(null)
        })
        child.once('close', (code) => {
            if (code !== 0) {
                resolve(null)
                return
            }
            const version = readFfmpegVersion(chunks.join(''))
            logger.info(`微博视频转码使用 ffmpeg：${executable}${version.length > 0 ? `（${version}）` : ''}`)
            resolve(executable)
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
            '-nostdin',
            // 协议白名单：即使上游用 302 把输入指向 file:// 或 concat，ffmpeg 也无法打开本地资源
            '-protocol_whitelist',
            'http,https,tcp,tls',
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

/**
 * 尝试转码一条视频：名额未满且 ffmpeg 可用才接管响应。
 * 返回 false 表示没有写出任何字节，调用方应回退原样转发（可能无声，但不至于播不了）。
 */
export async function serveTranscoded(target: string, response: ServerResponse): Promise<boolean> {
    if (activeTranscodes >= MAX_TRANSCODES) {
        return false
    }
    const ffmpeg = await resolveFfmpeg()
    if (ffmpeg === null) {
        return false
    }
    activeTranscodes += 1
    try {
        const isServed = await proxyTranscoded(ffmpeg, target, response)
        if (!isServed) {
            logger.warn('微博视频转码失败，回退原样转发（可能无声）')
        }
        return isServed
    } finally {
        activeTranscodes -= 1
    }
}
