/**
 * 笔记服务：把空笔记草稿落到存储根并立即纳入索引，或按索引路径打开已有笔记。
 * 复用 common/storagePath 的路径构造与片段校验、common/config 的存储根解析、IndexService 的单文件索引能力。
 * 命令面板与 Webview 入口共用同一实现。
 * 关键约束：写入前先判定存在性，同名重试而非覆盖；打开已有笔记的相对路径须先经片段校验，
 * 拒绝会越出存储根的拼装结果；交给 workspace.fs 的一律是带 file 协议的绝对路径。
 */
import * as vscode from 'vscode'
import { resolveStorageRoot } from '@modules/common/config'
import { logger } from '@modules/common/logger'
import { buildStorageUri, isPathExisting, toSafeSegments, toStorageRelativePath } from '@modules/common/storagePath'
import type { CreatedNote } from '@shared/types/note'
import { createNoteDraft } from './noteFactory'

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

/** 在编辑器中展示笔记：统一 preview: false，使每次打开都占据独立标签而非覆盖预览标签 */
async function showNoteDocument(uri: vscode.Uri): Promise<vscode.TextEditor> {
    const document = await vscode.workspace.openTextDocument(uri)
    return vscode.window.showTextDocument(document, { preview: false })
}

/** 在存储根下创建一篇空笔记并立即索引 */
export async function createNote(indexer: NoteIndexer): Promise<CreatedNoteHandle> {
    const root = resolveStorageRoot()
    logger.debug(`笔记存储根解析：scheme=${root.scheme} path=${root.path} fsPath=${root.fsPath}`)
    for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
        const draft = createNoteDraft(new Date())
        const directorySegments = draft.directory.split('/')
        const directory = buildStorageUri(root, directorySegments)
        const target = buildStorageUri(root, [...directorySegments, draft.fileName])
        if (await isPathExisting(target)) {
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

/** 用编辑器打开新建的笔记，并把光标落到末尾（空笔记即标题下方） */
export async function openNoteDocument(uri: vscode.Uri): Promise<void> {
    const editor = await showNoteDocument(uri)
    const position = new vscode.Position(editor.document.lineCount - 1, 0)
    editor.selection = new vscode.Selection(position, position)
    editor.revealRange(new vscode.Range(position, position))
}

/** 新建并打开空笔记：命令面板与 Webview 共用的完整动作 */
export async function createAndOpenNote(indexer: NoteIndexer): Promise<CreatedNote> {
    const created = await createNote(indexer)
    await openNoteDocument(created.uri)
    return { path: created.path, title: created.title }
}

/**
 * 打开索引库中已有的笔记：索引路径先归一化为存储根口径的相对路径，再拼装绝对路径交由编辑器展示，
 * 不移动既有光标位置。
 * 关键约束：先经 toStorageRelativePath 归一化（兼容历史记录的绝对路径形态），再经 toSafeSegments 校验片段；
 * 调用方须已按索引库确认该 path 存在，本函数不回查索引，文件在磁盘上缺失时由 openTextDocument 抛错上抛。
 */
export async function openNoteByPath(indexPath: string): Promise<void> {
    const root = resolveStorageRoot()
    const uri = buildStorageUri(root, toSafeSegments(toStorageRelativePath(indexPath, '笔记'), '笔记'))
    await showNoteDocument(uri)
    logger.info(`已打开笔记：${indexPath}`)
}
