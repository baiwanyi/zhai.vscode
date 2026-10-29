/**
 * VS Code Markdown 预览的图片路径插件：让 `![alt](@zhai/…)` 在原生预览里也能显示。
 * 复用约定：前缀判定与路径清理走 @shared/utils/zhaiPath，存储根取自 common/config 的 resolveStorageRoot；
 * 以 markdown-it 插件形式挂到预览渲染管线，不接管整篇渲染，其余语法保持原生行为。
 * 关键约束：预览 webview 的资源白名单只含工作区与当前文档目录，存储根通常在工作区之外，
 * 相对路径与 file:// 都会被拦下；因此优先把图片读成 data URI 内联，彻底绕开白名单，
 * 超过内联上限、扩展名不认识或读取失败时才退回相对路径（同盘）与 file://（跨盘），尽力而为。
 * 内联结果按 mtime + 体积缓存，同一张图在多次渲染中不重复读盘；非 `@zhai/` 前缀一律不处理。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveStorageRoot } from '@modules/common/config'
import { readZhaiRelativePath } from '@shared/utils/zhaiPath'

/** 单文件内联上限：覆盖 2K 级出图，再大 base64（约膨胀 1.37 倍）会让预览明显卡顿，改走相对路径兜底 */
export const MAX_INLINE_BYTES = 8 * 1024 * 1024

/** 内联缓存条目上限：一屏预览通常十几张图，留两倍余量，超出按写入顺序淘汰最早的 */
const MAX_INLINE_CACHE = 32

/** 扩展名 → MIME：不在表内的扩展名不内联，避免浏览器拿到不认识的 data URI */
const MIME_TYPES: Readonly<Record<string, string>> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    bmp: 'image/bmp',
    avif: 'image/avif',
    svg: 'image/svg+xml',
}

/** 内联缓存：mtime 与体积任一变化即视为换过文件，重新读取 */
interface InlineCacheEntry {
    mtimeMs: number
    size: number
    dataUri: string
}

const inlineCache = new Map<string, InlineCacheEntry>()

/** 渲染选项：只透传给原规则，不做解释 */
type RendererOptions = Record<string, unknown>

/** token 的最小接口：只需要读写属性，避免引入 @types/markdown-it */
interface MarkdownToken {
    attrGet(name: string): string | null
    attrSet(name: string, value: string): void
}

/** markdown-it 传入的渲染环境：预览扩展会放置当前文档 Uri */
interface MarkdownEnv {
    currentDocument?: { fsPath: string }
}

/** markdown-it 渲染器的最小接口：保留原有 image 规则以便链式调用 */
interface MarkdownRenderer {
    rules: Record<string, RenderRule | undefined>
    renderToken(tokens: readonly MarkdownToken[], idx: number, options: RendererOptions): string
}

/** 渲染规则签名，与 markdown-it 的 Renderer.RenderRule 对齐 */
type RenderRule = (
    tokens: readonly MarkdownToken[],
    idx: number,
    options: RendererOptions,
    env: MarkdownEnv,
    self: MarkdownRenderer,
) => string

/** markdown-it 实例的最小接口 */
export interface MarkdownItLike {
    renderer: MarkdownRenderer
}

/**
 * 把图片读成 data URI：预览 webview 只放行白名单内的资源，data URI 不受该限制。
 * 返回 null 表示不适合内联（扩展名未知、超过上限、读取失败），由调用方降级。
 */
function toInlineDataUri(absolutePath: string, ext: string): string | null {
    const mime = MIME_TYPES[ext]
    if (mime === undefined) {
        return null
    }
    try {
        const stat = fs.statSync(absolutePath)
        if (!stat.isFile() || stat.size > MAX_INLINE_BYTES) {
            return null
        }
        const cached = inlineCache.get(absolutePath)
        if (cached !== undefined && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
            return cached.dataUri
        }
        const dataUri = `data:${mime};base64,${fs.readFileSync(absolutePath).toString('base64')}`
        if (inlineCache.size >= MAX_INLINE_CACHE) {
            const oldest = inlineCache.keys().next()
            if (!oldest.done) {
                inlineCache.delete(oldest.value)
            }
        }
        inlineCache.set(absolutePath, { mtimeMs: stat.mtimeMs, size: stat.size, dataUri })
        return dataUri
    } catch {
        // 文件不存在或不可读：交给相对路径 / file:// 兜底，不让整篇预览渲染失败
        return null
    }
}

/**
 * 把 @zhai/ 引用转成预览可加载的地址：优先内联 data URI，其次相对当前文档，跨盘退回 file://。
 * 非存储根引用返回 null，调用方据此保持原值。
 */
export function resolvePreviewSrc(src: string, documentPath: string | undefined): string | null {
    const relative = readZhaiRelativePath(src)
    if (relative === null) {
        return null
    }
    const absolute = path.join(resolveStorageRoot().fsPath, ...relative.split('/'))
    const inlined = toInlineDataUri(absolute, path.extname(absolute).slice(1).toLowerCase())
    if (inlined !== null) {
        return inlined
    }
    if (documentPath !== undefined && documentPath !== '') {
        const related = path.relative(path.dirname(documentPath), absolute)
        if (related !== '' && !path.isAbsolute(related)) {
            return related.split(path.sep).join('/')
        }
    }
    return pathToFileURL(absolute).toString()
}

/** 挂载插件：只包装 image 渲染规则，命中前缀时改写 src 后交给原规则 */
export function zhaiImagePathPlugin(md: MarkdownItLike): void {
    const fallback = md.renderer.rules.image
    md.renderer.rules.image = (tokens, idx, options, env, self): string => {
        const token = tokens[idx]
        if (token !== undefined) {
            const src = token.attrGet('src')
            if (src !== null) {
                const replaced = resolvePreviewSrc(src, env.currentDocument?.fsPath)
                if (replaced !== null) {
                    token.attrSet('src', replaced)
                }
            }
        }
        if (fallback === undefined) {
            return self.renderToken(tokens, idx, options)
        }
        return fallback(tokens, idx, options, env, self)
    }
}
