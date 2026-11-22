/**
 * 图片代理：新浪图床按 Referer 放行，Webview 直连（源为 vscode-webview://）会被拒图，
 * 故由宿主取回图片、落本地缓存后再签发 Webview 可访问的地址。
 * 复用约定：下载通道与字节编解码分别在 media/imageNetwork 与 media/imageData，
 * 本文件只负责白名单校验、缓存命中与写入、并发闸门、重定向跟随与清理策略。
 * 关键约束：地址先经 normalizeWeiboImageUrl 收窄，只代理白名单域名；缓存按 URL 哈希命名，命中即零网络；
 * 每一跳重定向都要重新过白名单；失败不落盘；超过 24MB 的长图自动改用 bmiddle 缩略图，仍超限才放弃；
 * 同时下载数受闸门限制；清空缓存时一并清掉内联缓存，避免回放已删除的文件。
 */
import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as https from 'node:https'
import * as path from 'node:path'
import { logger } from '@modules/common/logger'
import { WEIBO_IMAGE_PID_PATTERN } from '@shared/types/weibo'
import { clearInlineCache } from './imageData'
import { describeImageUrl, loadImage, resolveImageExtension } from './imageNetwork'
import type { LoadedImage } from './imageNetwork'
import { WEIBO_AJAX_PATHS, WEIBO_WEB_ORIGIN } from '../endpoints'
import { buildMiddleImageUrl, normalizeWeiboImageUrl } from '../timeline/media'

/** 同时下载数：一页几十张图同时发起会把本地连接表与图床限流一起打满 */
const MAX_CONCURRENT_DOWNLOADS = 4

/** 缓存文件上限与清理目标：超出后按修改时间删旧，避免缓存无限增长 */
const MAX_CACHE_FILES = 800
const PRUNE_TARGET_FILES = 600

/** 触发清理的写入间隔：不必每次写入都扫目录 */
const PRUNE_INTERVAL_WRITES = 40

/** 清理时每批 stat 的文件数：全目录一次性 stat 会在 Windows 上撞 FD 上限 */
const PRUNE_STAT_BATCH = 40

/** 命中查找的扩展名顺序：与下载时可能产生的后缀一致 */
const CACHE_EXTENSIONS = ['jpg', 'png', 'gif', 'webp', 'bmp'] as const

/** 官方原图下载端点允许跟随的最大跳数：正常只有一跳，防上游循环重定向 */
const MAX_REDIRECTS = 3

/** 登录 Cookie 读取器：部分图床或微博域图片需要会话，403 时带上重试 */
export type WeiboCookieReader = () => Promise<string | undefined>

/** 图片代理：对外暴露「远程地址 → 本地路径」，并在面板关闭时释放连接池 */
export interface WeiboMediaProxy {
    /** 解析图片为本地缓存路径；失败返回 null，调用方据此回退占位 */
    resolve(imageUrl: string): Promise<string | null>
    /**
     * 按图片 pid 走官方下载端点取最大尺寸：该端点 302 到图床原图，需登录 Cookie。
     * 关键约束：pid 形态非法直接返回 null，调用方回退到直链下载。
     */
    resolveOriginal(pid: string): Promise<string | null>
    /** 清空整个图片缓存目录：清除凭证时调用，避免换号后旧账号图片残留磁盘 */
    clearCache(): Promise<void>
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

/**
 * 拼官方原图下载地址：`ajax/common/download?pid={pid}` 返回最大尺寸原图。
 * 复用约定：端点取自 weiboEndpoints 的 ajax 总表，按文件约定用 new URL 拼基址，不在此写路径字面量；
 * 关键约束：pid 只接受字母数字，非法值直接返回 null，由调用方回退直链。
 */
export function buildOriginalDownloadUrl(pid: string): string | null {
    if (!WEIBO_IMAGE_PID_PATTERN.test(pid)) {
        return null
    }
    const url = new URL(WEIBO_AJAX_PATHS.imageDownload, WEIBO_WEB_ORIGIN)
    url.searchParams.set('pid', pid)
    return url.toString()
}

/** 长图降级：换成中等尺寸版本；地址没有尺寸目录时返回 null，表示无法降级 */
function buildFallbackImageUrl(imageUrl: string): string | null {
    const middleUrl = buildMiddleImageUrl(imageUrl)
    return middleUrl === imageUrl ? null : middleUrl
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

    /**
     * 按修改时间删旧：只在文件数超限时触发，失败不影响主流程。
     * 关键约束：stat 分批执行——缓存上限 800 个文件，一次性并发 stat 会撞 FD 上限；
     * 单条 stat 失败只跳过该条（文件可能已被其它请求清理），不中止整轮清理。
     */
    async function prune(): Promise<void> {
        try {
            const names = await fs.readdir(cacheDir)
            if (names.length <= MAX_CACHE_FILES) {
                return
            }
            const entries: Array<{ full: string; mtime: number }> = []
            for (let index = 0; index < names.length; index += PRUNE_STAT_BATCH) {
                const batch = names.slice(index, index + PRUNE_STAT_BATCH)
                const stats = await Promise.all(
                    batch.map(async (name) => {
                        const full = path.join(cacheDir, name)
                        try {
                            const info = await fs.stat(full)
                            return { full, mtime: info.mtimeMs }
                        } catch {
                            return null
                        }
                    }),
                )
                for (const entry of stats) {
                    if (entry !== null) {
                        entries.push(entry)
                    }
                }
            }
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

    /**
     * 取图并跟随上游重定向：官方下载端点 302 到图床，代理与直连通道不会自动跟随。
     * 关键约束：每一跳都必须落在图片白名单内，避免被上游带去任意主机；跳数超限直接放弃。
     */
    async function loadFollowingRedirects(imageUrl: string): Promise<LoadedImage | null> {
        let current = imageUrl
        for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
            const loaded = await loadOnce(current)
            if (loaded === null) {
                return null
            }
            if (loaded.status < 300 || loaded.status >= 400 || loaded.location === null) {
                return loaded
            }
            let next: string | null
            try {
                next = normalizeWeiboImageUrl(new URL(loaded.location, current).toString())
            } catch {
                next = null
            }
            if (next === null) {
                logger.warn(`微博图片重定向到白名单外地址，已放弃：${describeImageUrl(current)}`)
                return null
            }
            current = next
        }
        logger.warn(`微博图片重定向次数超限，已放弃：${describeImageUrl(imageUrl)}`)
        return null
    }

    /** 下载并落盘：任何异常都收敛成 null，并记录可诊断的原因 */
    async function download(imageUrl: string, stem: string): Promise<string | null> {
        await acquireSlot()
        try {
            let loaded = await loadFollowingRedirects(imageUrl)
            // 超长图改取 bmiddle 小尺寸版本：同一对象，体积通常只有几十分之一
            if (loaded !== null && loaded.isOverLimit) {
                const fallbackUrl = buildFallbackImageUrl(imageUrl)
                if (fallbackUrl !== null) {
                    logger.warn(`微博图片超过体积上限，改取中等尺寸：${describeImageUrl(imageUrl)}`)
                    loaded = await loadFollowingRedirects(fallbackUrl)
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
            const ext = resolveImageExtension(loaded.contentType, loaded.body)
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
        resolveOriginal: async (pid: string): Promise<string | null> => {
            const url = buildOriginalDownloadUrl(pid)
            if (url === null) {
                // pid 是图床资源标识，不落日志：只记长度用于判断是误传还是畸形值
                logger.warn(`微博图片 pid 形态非法，跳过原图下载（长度 ${String(pid.length)}）`)
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
        clearCache: async (): Promise<void> => {
            clearInlineCache()
            try {
                await fs.rm(cacheDir, { recursive: true, force: true })
            } catch (error) {
                logger.warn(`微博图片缓存清理失败：${error instanceof Error ? error.message : String(error)}`)
            }
        },
        dispose: (): void => {
            directAgent.destroy()
        },
    }
}
