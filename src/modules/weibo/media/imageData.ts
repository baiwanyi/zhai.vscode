/**
 * 图片字节与 data URI 的编解码：魔数嗅探、MIME 回填与内联缓存，供代理、头像与笔记共用。
 * 复用约定：只处理内存中的 Buffer 与本地文件，不发起任何网络请求，可被任意层依赖。
 * 关键约束：只认静态位图（jpg/png/gif/webp/bmp），SVG 等可携带脚本的类型一律拒绝；
 * 内联结果按插入序淘汰，仅有默认上限的读取进缓存（调用方传更小上限时不得命中大图）。
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

/** 允许缓存的内容类型与扩展名：只收静态位图，SVG 等可携带脚本的类型一律拒绝 */
export const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/pjpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
    'image/x-ms-bmp': 'bmp',
}

/**
 * 回传 Webview 的单张上限（原始字节）：base64 会再膨胀约三分之一，
 * 上限压到 1.5MB 后单条字符串约 2MB；更大的图由面板改取 bmiddle 缩略图。
 */
const INLINE_MAX_BYTES = 1.5 * 1024 * 1024

/** 内联缓存条目上限：同一张图反复挂载时省掉读盘与 base64 编码 */
const INLINE_CACHE_ENTRIES = 12

/** 内联缓存总字符上限：约等于 12 张上限图的字符串体积，超出按插入序淘汰 */
const INLINE_CACHE_CHARS = 24 * 1024 * 1024

/** 扩展名 → MIME：缓存文件按魔数或内容类型落盘，这里只做回填 */
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
    jpg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
}

/** 内联结果缓存：key 为缓存文件路径，值为 data URI；按插入序淘汰最旧条目 */
const inlineCache = new Map<string, string>()

/** 缓存当前占用的字符数：避免每次淘汰都重算一遍长度 */
let inlineCacheChars = 0

/** 写入内联缓存：超条目或超字符体积时从最早写入的开始淘汰 */
function rememberInline(filePath: string, dataUrl: string): void {
    const previous = inlineCache.get(filePath)
    if (previous !== undefined) {
        inlineCacheChars -= previous.length
        inlineCache.delete(filePath)
    }
    if (dataUrl.length > INLINE_CACHE_CHARS) {
        return
    }
    inlineCache.set(filePath, dataUrl)
    inlineCacheChars += dataUrl.length
    while (inlineCacheChars > INLINE_CACHE_CHARS || inlineCache.size > INLINE_CACHE_ENTRIES) {
        const oldest = inlineCache.keys().next()
        if (oldest.done === true) {
            break
        }
        const removed = inlineCache.get(oldest.value)
        inlineCache.delete(oldest.value)
        inlineCacheChars -= removed?.length ?? 0
    }
}

/** 清空内联缓存：图片目录被删或换号后，不应再回放已不存在的文件 */
export function clearInlineCache(): void {
    inlineCache.clear()
    inlineCacheChars = 0
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
    // 只有默认上限的结果进缓存：调用方传更小的 maxBytes 时不能命中一张大图
    const isCacheable = maxBytes === INLINE_MAX_BYTES
    if (isCacheable) {
        const cached = inlineCache.get(filePath)
        if (cached !== undefined) {
            return cached
        }
    }
    try {
        const info = await fs.stat(filePath)
        if (!info.isFile() || info.size === 0 || info.size > maxBytes) {
            return null
        }
        const buffer = await fs.readFile(filePath)
        const dataUrl = buildImageDataUrl(buffer, path.extname(filePath).slice(1))
        if (isCacheable) {
            rememberInline(filePath, dataUrl)
        }
        return dataUrl
    } catch {
        return null
    }
}

/** 拼 data URI：未知扩展名按 jpeg 兜底，避免浏览器拒整条图片 */
export function buildImageDataUrl(buffer: Buffer, extension: string): string {
    const mime = MIME_BY_EXTENSION[extension.toLowerCase()] ?? 'image/jpeg'
    return `data:${mime};base64,${buffer.toString('base64')}`
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
