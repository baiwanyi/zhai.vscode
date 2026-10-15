/**
 * 笔记服务：把空笔记草稿落到存储根、立即纳入索引，并交由编辑器打开。
 * 复用 common 的存储根解析与日志、IndexService 的单文件索引能力；命令面板与 Webview 入口共用同一实现。
 * 关键约束：写入前先判定目标是否存在，同名则重新生成 ID 重试，绝不覆盖既有笔记；
 * 目标路径完全由宿主依据存储根拼装，不接受来自外部的路径参数。
 */
import * as vscode from 'vscode'
import { createNoteDraft } from './noteFactory'
import type { CreatedNote } from '../../shared/types/note'
import { resolveStorageRoot } from '../common/config'
import { logger } from '../common/logger'

/** 同名冲突时的最大重试次数 */
const MAX_CREATE_ATTEMPTS = 5

/** 创建笔记所需的最小索引能力：仅声明用到的方法，便于解耦与替身注入 */
export interface NoteIndexer {
    indexFile: (uri: vscode.Uri) => Promise<void>
}

/** 创建结果：额外携带 Uri 供调用方打开，返回给 Webview 时只取可序列化字段 */
export interface CreatedNoteHandle extends CreatedNote {
    uri: vscode.Uri
}

/** 判定目标是否已存在文件：stat 抛错即视为不存在（FileSystem 未提供 exists API） */
async function isFileExisting(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri)
        return true
    } catch {
        return false
    }
}

/** 在存储根下创建一篇空笔记并立即索引 */
export async function createNote(indexer: NoteIndexer): Promise<CreatedNoteHandle> {
    const root = resolveStorageRoot()
    for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
        const draft = createNoteDraft(new Date())
        const directory = vscode.Uri.joinPath(root, draft.directory)
        const target = vscode.Uri.joinPath(directory, draft.fileName)
        if (await isFileExisting(target)) {
            logger.debug(`笔记文件名冲突，重新生成：${draft.path}`)
            continue
        }
        await vscode.workspace.fs.createDirectory(directory)
        await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(draft.content))
        await indexer.indexFile(target)
        logger.info(`已创建笔记：${draft.path}`)
        return { path: draft.path, title: draft.title, uri: target }
    }
    throw new Error(`创建笔记失败：连续 ${MAX_CREATE_ATTEMPTS} 次文件名冲突`)
}

/** 用编辑器打开笔记，并把光标落到一级标题下方 */
export async function openNoteDocument(uri: vscode.Uri): Promise<void> {
    const document = await vscode.workspace.openTextDocument(uri)
    const editor = await vscode.window.showTextDocument(document, { preview: false })
    const position = new vscode.Position(document.lineCount - 1, 0)
    editor.selection = new vscode.Selection(position, position)
    editor.revealRange(new vscode.Range(position, position))
}

/** 新建并打开空笔记：命令面板与 Webview 共用的完整动作 */
export async function createAndOpenNote(indexer: NoteIndexer): Promise<CreatedNote> {
    const created = await createNote(indexer)
    await openNoteDocument(created.uri)
    return { path: created.path, title: created.title }
}
