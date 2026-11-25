/**
 * 模型写入文档的规范化：作品文档统一为纯正文，章节固定为「# 章节标题 + 章节内容」。
 * 复用约定：章节标题取文件名，沿用 projectFactory 的 toDisplayName 口径；
 * 存储根判定与作品路径分段复用 common/config 与 common/projectPath 的既有实现。
 * 关键约束：落盘前剥掉模型可能输出的元数据块，保证作品文件不含 frontmatter；
 * 模型写成二级标题时提升为一级并消除双标题，标题文本取写入值、无标题时才回退文件名；非作品路径原样返回。
 */
import { resolveStorageRoot } from '@modules/common/config'
import { PRESS_MODULE_DIR } from '@modules/common/projectPath'
import { PROJECT_CHAPTER_DIR, toDisplayName } from './projectFactory'

/** 相对存储根的路径：不在存储根内返回 null，在根自身返回空串 */
function toStorageRelative(filePath: string): string | null {
    const root = resolveStorageRoot().path.replace(/\\/gu, '/').toLowerCase()
    const normalized = filePath.replace(/\\/gu, '/')
    const lower = normalized.toLowerCase()
    if (lower === root) {
        return ''
    }
    if (!lower.startsWith(`${root}/`)) {
        return null
    }
    return normalized.slice(root.length + 1)
}

/** 剥掉开头的元数据块：模型偶尔会输出 --- 包裹的元信息，落盘前统一去掉 */
function stripLeadingMetaBlock(content: string): string {
    if (!content.startsWith('---')) {
        return content
    }
    const end = content.indexOf('\n---', 3)
    if (end < 0) {
        return content
    }
    return content.slice(end + 4).replace(/^(?:\r?\n)+/u, '')
}

/** 开头的一级或二级标题行：章节标题无论模型写成哪一级，都按这一行取文本 */
const LEADING_HEADING_PATTERN = /^(#{1,2})\s+([^\r\n]+)(?:\r?\n)*/u

/**
 * 统一章节标题为单个一级标题：优先采用模型写入的标题文本（通常来自章纲），
 * 最多剥掉开头两个连续标题行以消除「原 H1 + 新 H2」双标题；没有标题时回退文件名。
 * 关键约束：正文里更靠后的二级小节标题不受影响，标题文本只做 trim 不改写内容。
 */
function withChapterTitle(content: string, fallbackTitle: string): string {
    let rest = content.replace(/^\s+/u, '')
    let title = ''
    for (let count = 0; count < 2; count += 1) {
        const matched = LEADING_HEADING_PATTERN.exec(rest)
        if (matched === null) {
            break
        }
        title = (matched[2] ?? '').trim()
        rest = rest.slice(matched[0].length).replace(/^\s+/u, '')
    }
    const heading = title.length > 0 ? title : fallbackTitle
    return `${`# ${heading}\n${rest}`.trimEnd()}\n`
}

/**
 * 规范化模型写入的 Markdown：作品文档剥掉元数据块，章节再统一一级标题，其余文档原样返回。
 * 返回值为应落盘的内容，调用方需把它替换进工具入参的 content。
 */
export function normalizeWrittenDocument(filePath: string, content: string): string {
    if (!filePath.toLowerCase().endsWith('.md')) {
        return content
    }
    const relative = toStorageRelative(filePath)
    if (relative === null || relative.length === 0) {
        return content
    }
    const segments = relative.split('/')
    if (segments[0] !== PRESS_MODULE_DIR || segments.length < 3) {
        return content
    }
    const projectName = segments[1] ?? ''
    const fileName = segments[segments.length - 1] ?? ''
    const directory = segments[2] ?? ''
    if (projectName.length === 0) {
        return content
    }
    const cleaned = stripLeadingMetaBlock(content)
    if (directory === PROJECT_CHAPTER_DIR) {
        return withChapterTitle(cleaned, toDisplayName(fileName))
    }
    return cleaned
}
