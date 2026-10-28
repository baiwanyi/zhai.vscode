/**
 * 待办 Markdown 编解码：把清单文件解析成条目，或把条目变更写回原始行数组。
 * 复用约定：只认行首的 `- [ ]` / `- [x]`（兼容 `*`、`+` 与 `[X]`），其余行原样保留，
 * 用户可在同一文件里写说明文字而不被覆盖；文本长度与空白归一取 @shared/types/todo 的常量。
 * 关键约束：写回按行号改单行、按行插入或删除，不整篇重排，保证手写内容与行序不变；
 * 解析跳过空文本条目，序列化不做转义——文本原样写入，调用方须先经 normalizeTodoText 压成单行。
 */
import { MAX_TODO_TEXT_LENGTH } from '@shared/types/todo'

/** 清单标题行前缀：一级标题承载清单名，与文件名保持一致 */
const HEADING_PREFIX = '# '

/** 单条待办的正则：允许缩进与三种列表符号，勾选态接受空格、x 与 X */
const TODO_LINE_PATTERN = /^\s*[-*+]\s+\[([ xX])\]\s?(.*)$/u

/** 解析出的条目：line 为在文件中的行号，写回时据此定位 */
export interface TodoMarkdownEntry {
    line: number
    text: string
    done: boolean
}

/** 把待办原文压成单行：换行与连续空白折叠，去掉首尾空白，超长截断 */
export function normalizeTodoText(value: string): string {
    return value.replace(/\s+/gu, ' ').trim().slice(0, MAX_TODO_TEXT_LENGTH)
}

/** 切分文件内容：去 BOM、统一 LF，并丢弃末尾空行，使行号与写回口径一致 */
export function splitTodoLines(content: string): string[] {
    const lines = content
        .replace(/^\uFEFF/u, '')
        .replace(/\r\n?/gu, '\n')
        .split('\n')
    while (lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop()
    }
    return lines
}

/** 拼接行数组：空内容返回空串，否则补尾部换行，保证文件以换行结束 */
export function joinTodoLines(lines: readonly string[]): string {
    return lines.length === 0 ? '' : `${lines.join('\n')}\n`
}

/** 新建清单内容：只写一级标题，条目由后续追加，空清单在编辑器里也是一份合法文档 */
export function buildTodoListContent(name: string): string {
    return `${HEADING_PREFIX}${name}\n`
}

/** 解析条目：行号、文本与勾选态，空文本条目跳过 */
export function parseTodoMarkdown(content: string): TodoMarkdownEntry[] {
    const entries: TodoMarkdownEntry[] = []
    splitTodoLines(content).forEach((line, index) => {
        const matched = TODO_LINE_PATTERN.exec(line)
        if (matched === null) {
            return
        }
        const text = (matched[2] ?? '').trim()
        if (text.length === 0) {
            return
        }
        entries.push({ line: index, text, done: (matched[1] ?? ' ').toLowerCase() === 'x' })
    })
    return entries
}

/** 改单行的勾选态：只替换方括号内的标记，缩进、符号与文本保持原样 */
export function toggleTodoLine(lines: readonly string[], line: number, done: boolean): string[] {
    return lines.map((current, index) =>
        index === line ? current.replace(/\[([ xX])\]/u, done ? '[x]' : '[ ]') : current,
    )
}

/** 追加条目：末行非空时先补一个空行，使标题与列表之间有排版空行 */
export function appendTodoLines(lines: readonly string[], texts: readonly string[]): string[] {
    const next = [...lines]
    if (next.length > 0 && next[next.length - 1] !== '') {
        next.push('')
    }
    for (const text of texts) {
        next.push(`- [ ] ${text}`)
    }
    return next
}

/** 删除单行：按行号剔除，其余行（含说明文字）保持原位 */
export function removeTodoLine(lines: readonly string[], line: number): string[] {
    return lines.filter((_, index) => index !== line)
}

/**
 * 同步一级标题：把首个标题行改写成新清单名，其余行原样保留。
 * 关键约束：只认 `# ` 开头的一级标题；文件被用户改成无标题或直接用二级标题时不做插入，
 * 避免在正文里凭空多出一行。
 */
export function replaceHeading(lines: readonly string[], name: string): string[] {
    const index = lines.findIndex((line) => /^#\s+/u.test(line))
    if (index === -1) {
        return [...lines]
    }
    return lines.map((line, current) => (current === index ? `${HEADING_PREFIX}${name}` : line))
}
