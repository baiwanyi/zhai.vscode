/**
 * Markdown 元数据解析：从正文提取标题、标签、字数与内容 hash。
 * 复用约定：统一由本模块提供标题与标签口径，索引器和笔记标题解析共享同一实现；
 * 标签取自作品文档正文的「题材」字段，按顿号、逗号、分号与斜杠拆项。
 * 关键约束：不再解析元数据块，正文即全部内容；解析失败返回兜底值而不抛错，保证索引流水线不中断。
 */
import { createHash } from 'node:crypto'

export interface FileMeta {
    title: string
    wordCount: number
    tags: string[]
    hash: string
}

/** 题材字段标题：作品文档正文以三级标题承载该字段 */
const GENRES_HEADING_PATTERN = /^###\s+题材\s*$/mu

/**
 * 解析正文里的标签：取「### 题材」段首个非空行，按常见分隔符拆项。
 * 段落终点是一级到三级标题或下一个五级字段，避免把后续字段读进来。
 */
function parseBodyTags(body: string): string[] {
    const matched = GENRES_HEADING_PATTERN.exec(body)
    if (matched === null) {
        return []
    }
    const rest = body.slice(matched.index + matched[0].length)
    const section = /^#{1,3}\s+/mu.exec(rest)
    const content = section === null ? rest : rest.slice(0, section.index)
    const line = content.split(/\r?\n/u).find((item) => item.trim().length > 0)?.trim() ?? ''
    if (line.length === 0 || line.startsWith('#####')) {
        return []
    }
    return line
        .split(/[、,，;；/]/u)
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
}

/**
 * 提取标题：正文首个 `# ` 行，找不到时返回空串由调用方回退文件名。
 * 关键约束：章节列表标题直接来自这一行，正文必须保留一级标题。
 */
export function parseTitle(body: string): string {
    const heading = /^#\s+(.+)$/mu.exec(body)
    return heading?.[1]?.trim() ?? ''
}

/** 统计字数：去除 Markdown 标记与空白后的字符数（中英文统一近似值） */
export function countWords(body: string): number {
    return body
        .replace(/```[\s\S]*?```/g, '')
        .replace(/[#>*`~\-[\]()!|]/g, '')
        .replace(/\s/g, '').length
}

/** 计算 16 位十六进制内容 hash，用于跳过无实质变更的重写 */
export function contentHash(content: string): string {
    return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

/** 解析 Markdown 文件内容为索引元数据；title 为空时回退到传入的文件名 */
export function parseFileMeta(content: string, fileName: string): FileMeta {
    const title = parseTitle(content)
    return {
        title: title.length > 0 ? title : fileName,
        wordCount: countWords(content),
        tags: parseBodyTags(content),
        hash: contentHash(content),
    }
}
