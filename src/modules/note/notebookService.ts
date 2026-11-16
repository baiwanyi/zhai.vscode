/**
 * 笔记本服务：以 notes/ 下的一级目录为笔记本，负责列举、新建、重命名与删除。
 * 复用了 common/storagePath 的路径构造、common/db/fileMeta 的标题提取与 IndexService 的索引收敛能力。
 * 关键约束：笔记本列表必须扫盘取得——空目录不会出现在索引库，只查库会漏掉刚建好的笔记本；
 * 未分类既承载 notes/未分类 目录，也承载笔记根下的散落文档，禁止重命名与删除以保住默认落点语义；
 * 目录改名后须重建该目录的索引并迁移置顶与偏好，否则列表残留旧路径、置顶丢失；
 * 删除笔记本时笔记一律移入回收站，单条搬移失败不阻断其余条目，有失败时不删目录以免丢正文。
 */
import * as vscode from 'vscode'
import { resolveStorageRoot } from '@modules/common/config'
import { parseFileMeta } from '@modules/common/db/fileMeta'
import type { NotebookAggregate } from '@modules/common/db/statsRepository'
import { logger } from '@modules/common/logger'
import {
    buildStorageUri,
    deleteResource,
    isPathExisting,
    toSafeSegments,
    toStorageRelativePath,
} from '@modules/common/storagePath'
import type { DeleteNotebookResult, NotebookPrefs, NotebookSort, NotebookSummary } from '@shared/types/notebook'
import { NOTE_DIR, UNCLASSIFIED_DIR } from './noteFactory'
import { assertNoteSaved } from './noteService'
import type { TrashEntryInput } from './trashStore'

/** 笔记本名长度上限：与笔记文件名同口径，中文按 3 字节估算仍在 255 字节内 */
const MAX_NOTEBOOK_NAME_LENGTH = 60

/** 文件名中不可用的字符：与笔记文件名的合法化口径保持一致 */
const ILLEGAL_NAME_PATTERN = /[\\/:*?"<>|\p{Cc}]/gu

/** Windows 保留设备名：目录名同样不能使用 */
const RESERVED_DIR_NAMES: ReadonlySet<string> = new Set([
    'con',
    'prn',
    'aux',
    'nul',
    ...['com', 'lpt'].flatMap((prefix) => Array.from({ length: 9 }, (_, index) => `${prefix}${String(index + 1)}`)),
])

/** 月份目录名：notes/YYYYMM 视为按月自动归档，展示名做友好化但不限制重命名与删除 */
const MONTH_DIR_PATTERN = /^(\d{4})(\d{2})$/u

/** 笔记扩展名：重命名与删除只处理目录内的 Markdown 文档 */
const NOTE_EXTENSION = '.md'

/** 笔记本所需的索引能力 */
export interface NotebookIndexer {
    /** 归一化为相对存储根的路径：必须走实现方而不是 Uri.path，否则中文文件名会被百分号编码 */
    toRelativePath: (uri: vscode.Uri) => string
    indexFile: (uri: vscode.Uri) => Promise<void>
    removeFile: (relativePath: string) => void
    removeFilesUnder: (relativePrefix: string) => void
}

/** 笔记本所需的笔记置顶能力：目录改名/删除后保持置顶记录与正文同步 */
export interface NotebookPinStore {
    renamePrefix: (previousPrefix: string, nextPrefix: string) => Promise<void>
    removeUnder: (prefix: string) => Promise<void>
}

/** 笔记本所需的偏好能力：置顶顺序、排序方式与默认落点 */
export interface NotebookPrefStore {
    listPinned: () => string[]
    readPrefs: () => NotebookPrefs
    renameId: (previousId: string, nextId: string) => Promise<void>
    removeUnder: (id: string) => Promise<void>
    setDefault: (id: string | null) => Promise<void>
}

/** 笔记本所需的回收站能力：删除笔记本时笔记先入回收站 */
export interface NotebookTrash {
    moveToTrash: (entry: TrashEntryInput) => Promise<string>
}

/** 目录项：扫盘结果里只关心目录名 */
interface NotebookDirEntry {
    /** 目录名（即笔记本展示名来源） */
    name: string
    id: string
    mtime: string
}

/**
 * 笔记本名转目录名：非法字符置空格、连续空白折叠、去掉结尾点，空名与保留名回退。
 * 关键约束：与笔记文件名用同一套字符集，用户能把同一个名字用在笔记本与笔记上；
 * 回退值取「未分类」以外的中性名，避免与保留目录撞名。
 */
export function toNotebookDirName(name: string): string {
    const collapsed = name
        .replace(ILLEGAL_NAME_PATTERN, ' ')
        .replace(/\s+/gu, ' ')
        .trim()
        .replace(/\.+$/u, '')
        .trim()
    const clipped = collapsed.slice(0, MAX_NOTEBOOK_NAME_LENGTH).trim()
    if (clipped.length === 0) {
        throw new Error('笔记本名不能为空')
    }
    if (RESERVED_DIR_NAMES.has(clipped.toLowerCase()) || clipped === UNCLASSIFIED_DIR) {
        return `${clipped} 笔记本`
    }
    return clipped
}

/** 展示名友好化：月份目录换成「2026 年 10 月」，其余原样返回 */
function toNotebookDisplayName(dirName: string): string {
    const matched = MONTH_DIR_PATTERN.exec(dirName)
    if (matched === null) {
        return dirName
    }
    const month = Number(matched[2])
    return `${String(matched[1])} 年 ${String(month)} 月`
}

/** 把目录名与聚合统计拼成笔记本条目：无笔记时 mtime 回落目录自身时间 */
function toNotebookSummary(entry: NotebookDirEntry, aggregate: NotebookAggregate | undefined): NotebookSummary {
    const dirName = entry.name
    return {
        id: entry.id,
        name: toNotebookDisplayName(dirName),
        noteCount: aggregate?.noteCount ?? 0,
        wordCount: aggregate?.wordCount ?? 0,
        mtime: aggregate !== undefined && aggregate.mtime !== '' ? aggregate.mtime : entry.mtime,
        isPinned: false,
        isDefault: false,
        isAuto: MONTH_DIR_PATTERN.test(dirName),
        isUnclassified: dirName === UNCLASSIFIED_DIR,
    }
}

/** 排序：置顶项成组在前，组内按偏好方式排，名称兜底保证顺序稳定 */
export function sortNotebooks(
    notebooks: NotebookSummary[],
    sort: NotebookSort,
    pinnedIds: readonly string[],
): NotebookSummary[] {
    const pinned = new Set(pinnedIds)
    const compare = (a: NotebookSummary, b: NotebookSummary): number => {
        const isPinnedA = pinned.has(a.id)
        const isPinnedB = pinned.has(b.id)
        if (isPinnedA !== isPinnedB) {
            return isPinnedA ? -1 : 1
        }
        if (sort === 'mtime' && a.mtime !== b.mtime) {
            return a.mtime < b.mtime ? 1 : -1
        }
        return a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
    }
    return [...notebooks].sort(compare)
}

/**
 * 列举笔记本：扫盘得到目录集合，索引库提供计数与最近时间，偏好提供置顶与默认落点。
 * 关键约束：未分类即便目录尚未创建也恒在列表中，保证新建笔记始终有落点；
 * 扫盘失败（存储根不可用）时返回空列表，由页面呈现空态而不是抛错。
 */
export async function listNotebooks(
    aggregates: NotebookAggregate[],
    prefStore: NotebookPrefStore,
): Promise<NotebookSummary[]> {
    const entries = await readNotebookDirs()
    const byId = new Map(aggregates.map((item) => [item.id, item]))
    const prefs = prefStore.readPrefs()
    const pinnedIds = prefStore.listPinned()
    const pinned = new Set(pinnedIds)
    const notebooks = entries.map((entry) => {
        const summary = toNotebookSummary(entry, byId.get(entry.id))
        return { ...summary, isPinned: pinned.has(entry.id), isDefault: prefs.defaultId === entry.id }
    })
    return sortNotebooks(notebooks, prefs.sort, pinnedIds)
}

/** 新建笔记本：目录建好后立即可见，空目录不需要索引 */
export async function createNotebook(name: string): Promise<NotebookSummary> {
    const root = resolveStorageRoot()
    const dirName = toNotebookDirName(name)
    const existing = await readNotebookDirs()
    if (existing.some((entry) => entry.id.toLowerCase() === `${NOTE_DIR}/${dirName}`.toLowerCase())) {
        throw new Error(`已存在同名笔记本：${dirName}`)
    }
    const dirUri = buildStorageUri(root, [NOTE_DIR, dirName])
    await vscode.workspace.fs.createDirectory(dirUri)
    const stat = await vscode.workspace.fs.stat(dirUri)
    logger.info(`笔记本已创建：${NOTE_DIR}/${dirName}`)
    return toNotebookSummary(
        { name: dirName, id: `${NOTE_DIR}/${dirName}`, mtime: new Date(stat.mtime).toISOString() },
        undefined,
    )
}

/**
 * 重命名笔记本：目录整体改名后重建该目录索引，并迁移置顶路径与视图偏好。
 * 关键约束：未分类禁止改名（默认落点与散落文档的合并口径都锚定在该目录上）；
 * 新旧名仅大小写不同视为无变化直接返回，避免在大小写不敏感的文件系统上做出假成功。
 */
export async function renameNotebook(
    deps: { indexer: NotebookIndexer; pins: NotebookPinStore; prefStore: NotebookPrefStore },
    id: string,
    name: string,
): Promise<{ id: string; name: string }> {
    const segments = toSafeSegments(toStorageRelativePath(id, '笔记本'), '笔记本')
    const [moduleDir, currentDir] = segments
    if (moduleDir !== NOTE_DIR || currentDir === undefined || segments.length !== 2) {
        throw new Error(`不是可重命名的笔记本：${id}`)
    }
    if (currentDir === UNCLASSIFIED_DIR) {
        throw new Error('未分类是默认落点，不能重命名')
    }
    const root = resolveStorageRoot()
    const sourceUri = buildStorageUri(root, segments)
    if (!(await isPathExisting(sourceUri))) {
        throw new Error(`笔记本目录不存在：${id}`)
    }
    const nextDir = toNotebookDirName(name)
    if (nextDir.toLowerCase() === currentDir.toLowerCase()) {
        return { id, name: toNotebookDisplayName(currentDir) }
    }
    const nextUri = buildStorageUri(root, [NOTE_DIR, nextDir])
    if (await isPathExisting(nextUri)) {
        throw new Error(`已存在同名笔记本：${nextDir}`)
    }
    await vscode.workspace.fs.rename(sourceUri, nextUri, { overwrite: false })
    const previousId = `${NOTE_DIR}/${currentDir}`
    const nextId = `${NOTE_DIR}/${nextDir}`
    // 先清旧记录再逐个建新记录：watcher 在目录整体移动时不保证逐文件回调
    deps.indexer.removeFilesUnder(`${previousId}/`)
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(nextUri, `**/*${NOTE_EXTENSION}`))
    for (const file of files) {
        await deps.indexer.indexFile(file)
    }
    await deps.pins.renamePrefix(previousId, nextId)
    await deps.prefStore.renameId(previousId, nextId)
    logger.info(`笔记本已重命名：${previousId} → ${nextId}`)
    return { id: nextId, name: toNotebookDisplayName(nextDir) }
}

/**
 * 删除笔记本：目录内笔记逐条移入回收站，全部搬移成功后清理索引与偏好并移除空目录。
 * 关键约束：未分类禁止删除；单条失败不阻断其余条目，存在失败时保留目录，避免未搬走的正文被一并删掉；
 * 未保存的笔记拒绝搬移（与单篇删除同口径），避免移走后编辑器保存把文件写回原处。
 */
export async function deleteNotebook(
    deps: {
        indexer: NotebookIndexer
        pins: NotebookPinStore
        prefStore: NotebookPrefStore
        trash: NotebookTrash
    },
    id: string,
): Promise<DeleteNotebookResult> {
    const segments = toSafeSegments(toStorageRelativePath(id, '笔记本'), '笔记本')
    const [moduleDir, dirName] = segments
    if (moduleDir !== NOTE_DIR || dirName === undefined || segments.length !== 2) {
        throw new Error(`不是可删除的笔记本：${id}`)
    }
    if (dirName === UNCLASSIFIED_DIR) {
        throw new Error('未分类是默认落点，不能删除')
    }
    const root = resolveStorageRoot()
    const dirUri = buildStorageUri(root, segments)
    if (!(await isPathExisting(dirUri))) {
        throw new Error(`笔记本目录不存在：${id}`)
    }
    const notebookId = `${NOTE_DIR}/${dirName}`
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(dirUri, `**/*${NOTE_EXTENSION}`))
    const failures: { value: string; message: string }[] = []
    let trashedNotes = 0
    for (const file of files) {
        const indexPath = deps.indexer.toRelativePath(file)
        try {
            assertNoteSaved(file, indexPath)
            const title = await readTitle(file)
            await deps.trash.moveToTrash({ indexPath, notebookId, notebookName: dirName, title })
            deps.indexer.removeFile(indexPath)
            trashedNotes += 1
        } catch (cause) {
            failures.push({ value: indexPath, message: cause instanceof Error ? cause.message : String(cause) })
        }
    }
    if (failures.length > 0) {
        // 还有正文留在目录里，保留目录与索引记录，让用户能继续处理
        return { deleted: false, trashedNotes, failures }
    }
    deps.indexer.removeFilesUnder(`${notebookId}/`)
    await deps.pins.removeUnder(notebookId)
    await deps.prefStore.removeUnder(notebookId)
    await deleteResource(dirUri, true)
    logger.info(`笔记本已删除：${notebookId}（笔记 ${String(trashedNotes)} 篇已入回收站）`)
    return { deleted: true, trashedNotes, failures }
}

/** 读取笔记标题：解析失败时回落文件名，回收站展示不至于空白 */
async function readTitle(uri: vscode.Uri): Promise<string> {
    try {
        const content = new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(uri))
        const fileName = uri.fsPath.split(/[\\/]/u).pop() ?? uri.fsPath
        return parseFileMeta(content, fileName).title
    } catch {
        return uri.fsPath.split(/[\\/]/u).pop() ?? uri.fsPath
    }
}

/** 扫盘得出笔记本目录：未分类恒在首位，读目录失败时退回只含未分类 */
async function readNotebookDirs(): Promise<NotebookDirEntry[]> {
    const root = resolveStorageRoot()
    const notesUri = buildStorageUri(root, [NOTE_DIR])
    let names: string[] = []
    try {
        const entries = await vscode.workspace.fs.readDirectory(notesUri)
        names = entries
            .filter(([, fileType]) => fileType === vscode.FileType.Directory)
            .map(([name]) => name)
            .filter((name) => !name.startsWith('.'))
    } catch {
        // 笔记目录尚未创建：保持空集合，随后仍会补上未分类
    }
    if (!names.includes(UNCLASSIFIED_DIR)) {
        names.push(UNCLASSIFIED_DIR)
    }
    const entries: NotebookDirEntry[] = []
    for (const name of names) {
        const dirUri = buildStorageUri(root, [NOTE_DIR, name])
        let mtime = new Date().toISOString()
        try {
            const stat = await vscode.workspace.fs.stat(dirUri)
            mtime = new Date(stat.mtime).toISOString()
        } catch {
            // 目录不存在（未分类尚未创建）时用当前时间占位，展示层只作排序依据
        }
        entries.push({ name, id: `${NOTE_DIR}/${name}`, mtime })
    }
    return entries
}
