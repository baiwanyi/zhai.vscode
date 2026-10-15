/**
 * 笔记服务：把空笔记草稿落到存储根、立即纳入索引，并交由编辑器打开。
 * 复用 common 的存储根解析与日志、IndexService 的单文件索引能力；命令面板与 Webview 入口共用同一实现。
 * 关键约束：目标 Uri 以存储根 fsPath 显式拼接后交给 Uri.file 构造，不依赖 Uri.joinPath 的平台分支，
 * 保证交给 workspace.fs 的始终是带 file 协议的绝对路径；写入前先判定存在性，同名重试而非覆盖。
 */
import * as path from 'node:path'
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

/**
 * 以存储根为基准构造目标 Uri：先确认存储根可解析为本地绝对路径，再交给 path.join + Uri.file 构造。
 * 关键约束：workspace.fs 只接受带前导斜杠的绝对路径，而 Uri.file 仅在路径为盘符反斜杠写法时才补前导
 * 斜杠；path.join 在 Windows 下产出反斜杠形式，恰好满足该前提，故不再依赖 Uri.joinPath 的平台分支判断。
 * 校验前置到存储根，失败时把存储根形态一并带进错误信息，便于定位。
 */
function buildNoteUri(root: vscode.Uri, segments: string[]): vscode.Uri {
    const basePath = root.fsPath
    if (!path.isAbsolute(basePath)) {
        throw new Error(`文档保存目录不是绝对本地路径：${basePath}（scheme=${root.scheme} path=${root.path}）`)
    }
    return vscode.Uri.file(path.join(basePath, ...segments))
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
    logger.debug(`笔记存储根解析：scheme=${root.scheme} path=${root.path} fsPath=${root.fsPath}`)
    for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
        const draft = createNoteDraft(new Date())
        const directorySegments = draft.directory.split('/')
        const directory = buildNoteUri(root, directorySegments)
        const target = buildNoteUri(root, [...directorySegments, draft.fileName])
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
