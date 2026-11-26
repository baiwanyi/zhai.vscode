/**
 * Markdown frontmatter 边界识别：把文档开头的 `---` 元数据块与正文切开，供编辑器快照、校对取正文与落盘清洗共用。
 * 复用约定：只做文本切分，不解析 YAML——本项目的文档不写 frontmatter 字段，元数据内容对调用方不可见；
 * 返回的 offset 即正文起点，调用方据此换算块偏移、检查区间与正文起点。
 * 关键约束：首行必须恰好是 `---`（允许 CRLF），闭合行必须是独立的 `---`（允许行尾空白），
 * `---abc` 这类内容不算闭合；走到文末仍无闭合行时按「无 frontmatter」处理，避免把正文开头的分隔线当成元信息整段跳过。
 */

/** 元数据块边界：首行与闭合行都用这三个连字符 */
const FENCE = '---'

/** frontmatter 切分结果 */
export interface FrontmatterSplit {
    /** 元数据块原文，含首尾 `---` 与其后的换行；无 frontmatter 时为空串 */
    frontmatter: string
    /** 正文原文；无 frontmatter 时与输入相同 */
    body: string
    /** 正文在全文中的起始偏移：恒等于 frontmatter.length */
    offset: number
}

/** 无 frontmatter 的切分结果：正文即全文 */
function withoutFrontmatter(text: string): FrontmatterSplit {
    return { frontmatter: '', body: text, offset: 0 }
}

/**
 * 拆分 frontmatter 与正文。
 * 逐行扫描而非单个正则：空元数据块（`---` 紧接 `---`）、CRLF 与行尾空白都在同一套判定里，
 * 编辑器、校对与落盘清洗不会再各认一套口径。
 */
export function splitFrontmatter(text: string): FrontmatterSplit {
    if (!text.startsWith(`${FENCE}\n`) && !text.startsWith(`${FENCE}\r\n`)) {
        return withoutFrontmatter(text)
    }
    let cursor = text.indexOf('\n') + 1
    while (cursor < text.length) {
        const lineEnd = text.indexOf('\n', cursor)
        const raw = lineEnd < 0 ? text.slice(cursor) : text.slice(cursor, lineEnd)
        if (raw.replace(/\r$/u, '').trimEnd() === FENCE) {
            const end = lineEnd < 0 ? text.length : lineEnd + 1
            return { frontmatter: text.slice(0, end), body: text.slice(end), offset: end }
        }
        if (lineEnd < 0) {
            break
        }
        cursor = lineEnd + 1
    }
    return withoutFrontmatter(text)
}
