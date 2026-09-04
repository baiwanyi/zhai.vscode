/**
 * Markdown 元数据解析：从文件内容提取标题、标签、字数与内容 hash。
 * 约束：仅解析元数据，正文绝不写入索引库；解析失败返回兜底值而不抛错，保证索引流水线不中断。
 */
import { createHash } from 'node:crypto'

export interface FileMeta {
    title: string
    wordCount: number
    tags: string[]
    hash: string
}

/** 从 Frontmatter 行提取 YAML 风格 tags：`tags: [a, b]` 或逐项 `- a` */
function parseFrontmatterTags(frontmatter: string): string[] {
    const tags: string[] = []
    const lines = frontmatter.split(/\r?\n/)
    let inTags = false
    for (const line of lines) {
        if (line.startsWith('tags:')) {
            const inline = line.slice('tags:'.length).trim()
            if (inline.startsWith('[') && inline.endsWith(']')) {
                tags.push(...inline.slice(1, -1).split(',').map((t) => t.trim().replace(/^['"]|['"]$/g, '')).filter((t) => t.length > 0))
            }
            inTags = true
            continue
        }
        if (inTags) {
            const match = /^\s*-\s+(.+)$/.exec(line)
            if (match?.[1] !== undefined) {
                tags.push(match[1].trim().replace(/^['"]|['"]$/g, ''))
            } else {
                inTags = false
            }
        }
    }
    return tags
}

/** 解析 Frontmatter 区块，返回区块内容与是否闭合 */
function splitFrontmatter(content: string): { frontmatter: string; body: string } {
    if (!content.startsWith('---')) {
        return { frontmatter: '', body: content }
    }
    const end = content.indexOf('\n---', 3)
    if (end < 0) {
        return { frontmatter: '', body: content }
    }
    return { frontmatter: content.slice(4, end), body: content.slice(end + 4) }
}

/** 提取标题：Frontmatter title 优先，其次首个 `# ` 行，兜底文件名由调用方补 */
export function parseTitle(body: string, frontmatter: string): string {
    const titleMatch = /^title:\s*(.+)$/m.exec(frontmatter)
    if (titleMatch?.[1] !== undefined) {
        return titleMatch[1].trim().replace(/^['"]|['"]$/g, '')
    }
    const heading = /^#\s+(.+)$/m.exec(body)
    if (heading?.[1] !== undefined) {
        return heading[1].trim()
    }
    return ''
}

/** 统计字数：去除 Markdown 标记与空白后的字符数（中英文统一近似值） */
export function countWords(body: string): number {
    return body
        .replace(/```[\s\S]*?```/g, '')
        .replace(/[#>*`~\-[\]()!|]/g, '')
        .replace(/\s/g, '')
        .length
}

/** 计算 16 位十六进制内容 hash，用于跳过无实质变更的重写 */
export function contentHash(content: string): string {
    return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

/** 解析 Markdown 文件内容为索引元数据；title 为空时回退到传入的文件名 */
export function parseFileMeta(content: string, fileName: string): FileMeta {
    const { frontmatter, body } = splitFrontmatter(content)
    const title = parseTitle(body, frontmatter)
    return {
        title: title.length > 0 ? title : fileName,
        wordCount: countWords(body),
        tags: parseFrontmatterTags(frontmatter),
        hash: contentHash(content),
    }
}
