/**
 * AI 纯文本清洗：把模型输出收敛为可直接写入单个字段的正文。
 * 复用约定：外貌生成与设定字段生成共用这一个入口，去代码围栏、标题符号、列表符号与首尾引号，压缩空行后截断。
 * 关键约束：模型输出一律视为不可信；先清洗再按长度裁切并补省略号，避免半截符号留在正文里；
 * 折行只保留段落结构，写入 Markdown 键值行时由调用方再折成单行。
 */

/** 列表符号与编号前缀 */
const BULLET_PATTERN = /^[-*•]\s+/
const NUMBERING_PATTERN = /^\d+[.、)]\s*/
/** 首尾可能出现的引号与书名号 */
const WRAPPING_PATTERN = /^[「『"'《]+|[」』"'》]+$/g

/** 压平多行：已填字段可能带换行，进提示词前折成一行，避免把字段结构拆断 */
export function toSingleLine(value: string): string {
    return value.replace(/\s*\r?\n\s*/gu, ' ').trim()
}

/** 清洗模型输出：去围栏、标题、列表与引号，合并空行并截断 */
export function sanitizePlainText(content: string, maxLength: number): string {
    const cleaned = content
        .replace(/```[a-zA-Z]*/g, '')
        .replace(/```/g, '')
        .split('\n')
        .map((line) =>
            line
                .replace(/^#{1,6}\s*/, '')
                .replace(BULLET_PATTERN, '')
                .replace(NUMBERING_PATTERN, '')
                .trim(),
        )
        .filter((line) => line.length > 0)
        .join('\n')
        .replace(WRAPPING_PATTERN, '')
        .trim()
    return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}…` : cleaned
}
