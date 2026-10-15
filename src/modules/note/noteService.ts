/**
 * 笔记服务：把空笔记草稿落到存储根并立即纳入索引，或按索引路径打开已有笔记。
 * 复用 common 的存储根解析与日志、IndexService 的单文件索引能力；命令面板与 Webview 入口共用同一实现。
 * 关键约束：目标 Uri 以存储根 fsPath 显式拼接后交给 Uri.file 构造，不依赖 Uri.joinPath 的平台分支，
 * 保证交给 workspace.fs 的始终是带 file 协议的绝对路径；写入前先判定存在性，同名重试而非覆盖；
 * 打开已有笔记的相对路径须先经片段校验，拒绝会越出存储根的拼装结果。
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

/**
 * 切分并校验索引库口径的相对路径：忽略空段，含上跳、当前目录、盘符或反斜杠的输入一律拒绝。
 * 安全约束：path.join 会规范化上跳片段，未校验时 `notes/../..` 之类的输入可越出存储根。
 */
function toSafeSegments(relativePath: string): string[] {
    const segments = relativePath.split('/').filter((segment) => segment.length > 0)
    const isUnsafeSegment = (segment: string): boolean =>
        segment === '.' || segment === '..' || segment.includes('\\') || segment.includes(':')
    if (segments.length === 0 || segments.some(isUnsafeSegment)) {
        throw new Error(`笔记路径非法：${relativePath}`)
    }
    return segments
}

/** 路径比较用的规范化：去掉前导与尾部斜杠并统一小写（Windows 上盘符大小写不影响路径同一性） */
function normalizeForCompare(value: string): string {
    return value.replace(/^\/+/, '').replace(/\/+$/, '').toLowerCase()
}

/**
 * 归一化为存储根口径的相对路径：索引库的历史记录可能存有绝对形式（Uri.path，如 /c:/root/notes/a.md），
 * 此时按存储根前缀剥离为相对路径；不属于存储根的绝对路径直接拒绝。
 * 关键约束：比较统一小写并忽略前导斜杠差异，避免 Uri.path 与 fsPath 的形态差异导致误判；
 * 归一化只做前缀剥离，越出存储根的进一步尝试仍由 toSafeSegments 拦截。
 */
function toStorageRelativePath(indexPath: string): string {
    if (!indexPath.startsWith('/')) {
        return indexPath
    }
    const rootPath = resolveStorageRoot().path
    if (!normalizeForCompare(indexPath).startsWith(`${normalizeForCompare(rootPath)}/`)) {
        throw new Error(`笔记路径不在存储根内：${indexPath}`)
    }
    const rawRoot = rootPath.replace(/^\/+/, '').replace(/\/+$/, '')
    return indexPath.replace(/^\/+/, '').slice(rawRoot.length + 1)
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
    const uri = buildNoteUri(root, toSafeSegments(toStorageRelativePath(indexPath)))
    await showNoteDocument(uri)
    logger.info(`已打开笔记：${indexPath}`)
}
