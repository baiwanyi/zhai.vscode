/**
 * 笔记服务：把空笔记草稿落到存储根并立即纳入索引，按索引路径打开已有笔记，或把笔记从磁盘移除并收敛索引。
 * 复用 common/storagePath 的路径构造、片段校验与统一删除入口、common/config 的存储根解析、IndexService 的单文件索引能力。
 * 命令面板与 Webview 入口共用同一实现。
 * 关键约束：新笔记标题为「未命名笔记 N」，N 从 1 起在同月目录内顺延，写入前先判定存在性，同名顺延而非覆盖；
 * 打开与删除的相对路径须先经片段校验，拒绝会越出存储根的拼装结果；
 * 删除只接受 notes/ 目录下的 Markdown 文档，其它归属的路径即便在索引内也一律拒绝；
 * 有未保存修改的文档拒绝删除，避免删盘后编辑器再保存把文件写回；
 * 交给 workspace.fs 的一律是带 file 协议的绝对路径。
 */
import * as vscode from 'vscode'
import { resolveStorageRoot } from '@modules/common/config'
import { logger } from '@modules/common/logger'
import type { DeleteOutcome } from '@modules/common/storagePath'
import {
    buildStorageUri,
    deleteResource,
    isPathExisting,
    toSafeSegments,
    toStorageRelativePath,
} from '@modules/common/storagePath'
import { openStorageDocument } from '@modules/editor/openDocument'
import type { CreatedNote } from '@shared/types/note'
import { NOTE_DIR, buildDefaultNoteTitle, createNoteDraft } from './noteFactory'

/** 默认标题的序号上限：同月已有 N 篇未命名笔记时顺延到 N+1，取一个足够大的上限兜住异常目录 */
const MAX_CREATE_ATTEMPTS = 200

/** 笔记文件的扩展名：删除时据此确认目标是笔记文档而非目录或其它类型的文件 */
const NOTE_EXTENSION = '.md'

/** 笔记写盘所需的最小索引能力：仅声明用到的方法，便于解耦与替身注入 */
export interface NoteIndexer {
    indexFile: (uri: vscode.Uri) => Promise<void>
    /** 删除单份文档的索引记录：笔记删除后主动收敛，不依赖 watcher 的删除回调 */
    removeFile: (relativePath: string) => void
}

/** 创建结果：额外携带 Uri 供调用方打开，返回给 Webview 时只取可序列化字段 */
export interface CreatedNoteHandle extends CreatedNote {
    uri: vscode.Uri
}

/** 展示笔记：统一走打开入口，由 openDocument 按入口策略决定富文本或文本编辑器 */
async function showNoteDocument(uri: vscode.Uri): Promise<void> {
    await openStorageDocument(uri)
}

/**
 * 在存储根下创建一篇空笔记并立即索引。
 * 标题从「未命名笔记 1」开始按序顺延：文件名即标题，同月已有同号笔记时取下一个序号，
 * 因此序号连续性只取决于目录现状，不依赖任何额外计数。
 */
export async function createNote(indexer: NoteIndexer): Promise<CreatedNoteHandle> {
    const root = resolveStorageRoot()
    logger.debug(`笔记存储根解析：scheme=${root.scheme} path=${root.path} fsPath=${root.fsPath}`)
    for (let index = 1; index <= MAX_CREATE_ATTEMPTS; index += 1) {
        const draft = createNoteDraft(new Date(), buildDefaultNoteTitle(index))
        const directorySegments = draft.directory.split('/')
        const directory = buildStorageUri(root, directorySegments)
        const target = buildStorageUri(root, [...directorySegments, draft.fileName])
        if (await isPathExisting(target)) {
            logger.debug(`笔记文件已存在，序号顺延：${draft.path}`)
            continue
        }
        await vscode.workspace.fs.createDirectory(directory)
        await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(draft.content))
        await indexer.indexFile(target)
        logger.info(`已创建笔记：${draft.path}`)
        return { path: draft.path, title: draft.title, uri: target }
    }
    throw new Error(`创建笔记失败：连续 ${MAX_CREATE_ATTEMPTS} 个序号均已存在`)
}

/** 打开新建的笔记：交给统一入口；空笔记没有定位需求，不再强设光标 */
export async function openNoteDocument(uri: vscode.Uri): Promise<void> {
    await showNoteDocument(uri)
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

/**
 * 阻止删除有未保存修改的笔记：磁盘文件被删后编辑器内容仍是脏的，用户一旦保存就会把文件写回，
 * 造成「已删除却复活」的错觉，因此要求先保存再删。
 */
function assertNoteSaved(uri: vscode.Uri, indexPath: string): void {
    const opened = vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString())
    if (opened !== undefined && opened.isDirty) {
        throw new Error(`笔记有未保存的修改，请先保存再删除：${indexPath}`)
    }
}

/**
 * 删除单篇笔记：归属校验通过后从磁盘移除并清理索引记录，返回删除方式供调用方区分可否恢复。
 * 关键约束：调用方须已按索引库确认该 path 是登记的笔记，本函数只做片段与归属复核；
 * 归属校验同时收窄一级目录与扩展名，避免把路径拼装错误放大成删除其它模块的文档；
 * 磁盘上已不存在的文件视为失败而非静默成功，避免索引里留着无效条目却提示删除完成。
 */
export async function deleteNote(indexer: NoteIndexer, indexPath: string): Promise<DeleteOutcome> {
    const segments = toSafeSegments(toStorageRelativePath(indexPath, '笔记'), '笔记')
    const [moduleDir] = segments
    const fileName = segments[segments.length - 1] ?? ''
    if (moduleDir !== NOTE_DIR || !fileName.toLowerCase().endsWith(NOTE_EXTENSION)) {
        throw new Error(`不是可删除的笔记文档：${indexPath}`)
    }
    const target = buildStorageUri(resolveStorageRoot(), segments)
    if (!(await isPathExisting(target))) {
        throw new Error(`笔记文件不存在，可能已被移除：${indexPath}`)
    }
    assertNoteSaved(target, indexPath)
    const outcome = await deleteResource(target, false)
    indexer.removeFile(segments.join('/'))
    logger.info(`已删除笔记：${indexPath}（${outcome === 'trash' ? '移入回收站' : '永久删除'}）`)
    return outcome
}
