/**
 * 笔记服务：把空笔记草稿或外部内容落到指定笔记本并立即纳入索引，按索引路径打开已有笔记，或把笔记移入回收站。
 * 复用 common/storagePath 的路径构造、片段校验与统一删除入口、common/config 的存储根解析、IndexService 的单文件索引能力。
 * 命令面板、Webview 入口与微博剪藏共用同一实现。
 * 关键约束：新笔记标题为「未命名笔记 N」，N 从 1 起在目标笔记本内顺延，写入前先判定存在性，同名顺延而非覆盖；
 * 落点目录须先经 toNoteDirectory 收窄为 notes/<单段>，拒绝会越出存储根的拼装结果；
 * 移除笔记只接受 notes/ 目录下的 Markdown 文档，其它归属的路径即便在索引内也一律拒绝；
 * 有未保存修改的文档拒绝移除，避免移走后编辑器再保存把文件写回原处；
 * 外部内容（微博剪藏等）按调用方给到的标题与正文落盘，正文长度设上限、标题同样走合法化收窄；
 * 交给 workspace.fs 的一律是带 file 协议的绝对路径。
 */
import * as vscode from 'vscode'
import { resolveStorageRoot } from '@modules/common/config'
import { logger } from '@modules/common/logger'
import { buildStorageUri, isPathExisting, toSafeSegments, toStorageRelativePath } from '@modules/common/storagePath'
import { openStorageDocument } from '@modules/editor/openDocument'
import type { CreatedNote } from '@shared/types/note'
import {
    DEFAULT_NOTE_DIRECTORY,
    NOTE_DIR,
    buildDefaultNoteTitle,
    createNoteDraft,
    toNoteDirectory,
    toNoteFileName,
} from './noteFactory'

/** 默认标题的序号上限：同月已有 N 篇未命名笔记时顺延到 N+1，取一个足够大的上限兜住异常目录 */
const MAX_CREATE_ATTEMPTS = 200

/** 笔记文件的扩展名：删除时据此确认目标是笔记文档而非目录或其它类型的文件 */
const NOTE_EXTENSION = '.md'

/** 外部内容写入正文的上限：超出直接拒绝，避免不可信来源把整段超长文本写进存储根 */
const MAX_NOTE_CONTENT_LENGTH = 100_000

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
 * 在指定笔记本下创建一篇空笔记并立即索引，未指定时落未分类。
 * 标题从「未命名笔记 1」开始按序顺延：文件名即标题，目标目录已有同号笔记时取下一个序号，
 * 因此序号连续性只取决于目录现状，不依赖任何额外计数。
 */
export async function createNote(
    indexer: NoteIndexer,
    directory: string = DEFAULT_NOTE_DIRECTORY,
): Promise<CreatedNoteHandle> {
    const root = resolveStorageRoot()
    // 落点先收窄：即便上游传了越界片段，也在这里被拒绝，不会拼到存储根之外
    const targetDirectory = toNoteDirectory(directory)
    logger.debug(`笔记存储根解析：scheme=${root.scheme} path=${root.path} fsPath=${root.fsPath}`)
    for (let index = 1; index <= MAX_CREATE_ATTEMPTS; index += 1) {
        const draft = createNoteDraft(buildDefaultNoteTitle(index), targetDirectory)
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

/** 带正文的笔记创建入参：标题决定文件名，正文按 Markdown 原文写入 */
export interface NoteContentInput {
    /** 笔记标题：经 toNoteFileName 收窄后作为文件名，重名时追加序号 */
    title: string
    /** 笔记正文（已是 Markdown 原文）：转义与结构由调用方负责，本层不改写内容 */
    markdown: string
    /** 目标笔记本（notes/<单段>），缺省落未分类 */
    directory?: string
}

/**
 * 按给定正文创建笔记并立即索引：外部内容落地笔记的统一入口（微博剪藏等）。
 * 关键约束：标题经 toNoteFileName 收窄后作为文件名，重名时追加序号顺延，绝不覆盖既有笔记；
 * 正文长度设上限，外部来源超限直接拒绝；目录仍走 toNoteDirectory 收窄，保证不会越出存储根。
 */
export async function createNoteFromContent(indexer: NoteIndexer, input: NoteContentInput): Promise<CreatedNoteHandle> {
    const markdown = input.markdown.trim()
    if (markdown.length === 0) {
        throw new Error('笔记正文为空，未写入')
    }
    if (markdown.length > MAX_NOTE_CONTENT_LENGTH) {
        throw new Error(`笔记正文过长（${String(markdown.length)} 字），超过 ${String(MAX_NOTE_CONTENT_LENGTH)} 字上限`)
    }
    const title = input.title.trim()
    if (title.length === 0) {
        throw new Error('笔记标题为空，未写入')
    }
    const root = resolveStorageRoot()
    const targetDirectory = toNoteDirectory(input.directory ?? DEFAULT_NOTE_DIRECTORY)
    const directorySegments = targetDirectory.split('/')
    const directoryUri = buildStorageUri(root, directorySegments)
    for (let index = 1; index <= MAX_CREATE_ATTEMPTS; index += 1) {
        const candidateTitle = index === 1 ? title : `${title} ${String(index)}`
        const fileName = toNoteFileName(candidateTitle)
        const target = buildStorageUri(root, [...directorySegments, fileName])
        if (await isPathExisting(target)) {
            logger.debug(`笔记文件已存在，序号顺延：${targetDirectory}/${fileName}`)
            continue
        }
        await vscode.workspace.fs.createDirectory(directoryUri)
        // 末尾补换行：Markdown 文件以空行收尾，与编辑器保存后的形态一致
        await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(`${markdown}\n`))
        await indexer.indexFile(target)
        logger.info(`已创建笔记：${targetDirectory}/${fileName}`)
        return { path: `${targetDirectory}/${fileName}`, title: candidateTitle, uri: target }
    }
    throw new Error(`创建笔记失败：连续 ${String(MAX_CREATE_ATTEMPTS)} 个序号均已存在`)
}

/** 打开新建的笔记：交给统一入口；空笔记没有定位需求，不再强设光标 */
export async function openNoteDocument(uri: vscode.Uri): Promise<void> {
    await showNoteDocument(uri)
}

/** 新建并打开空笔记：命令面板与 Webview 共用的完整动作 */
export async function createAndOpenNote(
    indexer: NoteIndexer,
    directory: string = DEFAULT_NOTE_DIRECTORY,
): Promise<CreatedNote> {
    const created = await createNote(indexer, directory)
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
 * 阻止移走有未保存修改的笔记：文件搬进回收站后编辑器内容仍是脏的，用户一旦保存就会把文件写回原处，
 * 造成「已删除却复活」的错觉，因此要求先保存再移走。
 */
export function assertNoteSaved(uri: vscode.Uri, indexPath: string): void {
    const opened = vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString())
    if (opened !== undefined && opened.isDirty) {
        throw new Error(`笔记有未保存的修改，请先保存再删除：${indexPath}`)
    }
}

/**
 * 校验目标是一篇可移除的笔记：只认 notes/ 一级目录下的 Markdown 文档。
 * 关键约束：调用方须已按索引库确认该 path 存在；归属校验同时收窄一级目录与扩展名，
 * 避免把路径拼装错误放大成移除其它模块的文档。
 */
export function assertRemovableNote(indexPath: string): string[] {
    const segments = toSafeSegments(toStorageRelativePath(indexPath, '笔记'), '笔记')
    const [moduleDir] = segments
    const fileName = segments[segments.length - 1] ?? ''
    if (moduleDir !== NOTE_DIR || !fileName.toLowerCase().endsWith(NOTE_EXTENSION)) {
        throw new Error(`不是可删除的笔记文档：${indexPath}`)
    }
    return segments
}

/** 判定笔记文件当前是否存在于磁盘：移入回收站前用它排除索引残留 */
export async function isNoteExisting(indexPath: string): Promise<boolean> {
    const segments = assertRemovableNote(indexPath)
    return isPathExisting(buildStorageUri(resolveStorageRoot(), segments))
}
