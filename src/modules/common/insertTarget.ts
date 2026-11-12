/**
 * 插入目标解析：为「把引用写进当前 Markdown 文档」提供统一的编辑器入口，媒体与上传共用。
 * 复用约定：优先活动编辑器，其次最近可见的 Markdown 文档编辑器，与媒体库插入口径一致。
 * 关键约束：只负责取编辑器；文档是否已保存、是否为 Markdown 由调用方按各自回执原因判定，
 * 本函数不返回失败原因，避免两处语义分叉。
 */
import * as vscode from 'vscode'
import { getActiveDocument } from '@modules/editor/activeDocument'

/**
 * 取插入目标：优先活动编辑器，其次最近可见的 Markdown 编辑器。
 * 富文本 tab 没有 TextEditor，此时直接返回 undefined——回退到其它可见编辑器会插进错误的文档。
 */
export function resolveMarkdownEditor(): vscode.TextEditor | undefined {
    if (getActiveDocument()?.kind === 'rich') {
        return undefined
    }
    const active = vscode.window.activeTextEditor
    if (active !== undefined) {
        return active
    }
    return [...vscode.window.visibleTextEditors]
        .reverse()
        .find((item) => item.document.languageId === 'markdown' && item.document.uri.scheme === 'file')
}
