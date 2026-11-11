/**
 * Markdown 块级插入：把引用片段作为独立段落写进光标处，并与上下文之间各留一个空行。
 * 复用约定：媒体、图库与上传三条插入链路共用；上下文读取与段落拼装拆成两半，拼装部分是纯函数，便于单测。
 * 关键约束：光标前同行有内容时先换行、再空一行；光标在行首时只有上一行非空才补空行，后缀同理；
 * 文档首尾没有上下文时不硬造空行，避免文件以空白行开头或结尾；
 * 返回片段在写入文本中的起始偏移，调用方据此把选区落在引用本身上，而不是选到前后空行。
 */
import type * as vscode from 'vscode'

/** 光标处的块上下文：同行前后文与相邻两行 */
export interface BlockContext {
    /** 光标前同行文本 */
    before: string
    /** 光标后同行文本 */
    after: string
    /** 上一行文本：光标在首行时为 null */
    previous: string | null
    /** 下一行文本：光标在末行时为 null */
    next: string | null
}

/** 块级插入结果：实际写入文本与引用片段的起始偏移 */
export interface BlockInsertion {
    text: string
    /** 引用片段在 text 中的起始偏移 */
    start: number
}

/** 是否为空白行：只有空白字符也算空行 */
function isBlank(text: string): boolean {
    return text.trim().length === 0
}

/**
 * 读取光标处的块上下文：只做切片，不做判断。
 * @param document 目标文档
 * @param position 插入位置（通常是 editor.selection.active）
 */
export function readBlockContext(document: vscode.TextDocument, position: vscode.Position): BlockContext {
    const line = document.lineAt(position.line)
    return {
        before: line.text.slice(0, position.character),
        after: line.text.slice(position.character),
        previous: position.line > 0 ? document.lineAt(position.line - 1).text : null,
        next: position.line < document.lineCount - 1 ? document.lineAt(position.line + 1).text : null,
    }
}

/**
 * 把片段包成独立段落：前后各留一个空行，光标夹在行中间时先把当前行断开。
 * @param context 光标处上下文，见 readBlockContext
 * @param snippet 已拼好的引用片段
 */
export function buildBlockInsertion(context: BlockContext, snippet: string): BlockInsertion {
    const { before, after, previous, next } = context

    let prefix = ''
    if (before.trim().length > 0) {
        // 光标前同行有内容：换行后空一行，引用自成一段
        prefix = '\n\n'
    } else if (previous !== null && !isBlank(previous)) {
        prefix = '\n'
    }

    let suffix = ''
    if (after.trim().length > 0) {
        suffix = '\n\n'
    } else if (next !== null && !isBlank(next)) {
        suffix = '\n'
    }

    return { text: `${prefix}${snippet}${suffix}`, start: prefix.length }
}
