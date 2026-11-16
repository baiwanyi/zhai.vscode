/**
 * 笔记回收站仓储：把待删笔记移入存储根下的 .trash/{id}/，并支持列出、恢复与彻底清除。
 * 复用 common/storagePath 的路径构造与片段校验，恢复后经 IndexService 的 indexFile 重新纳入索引。
 * 关键约束：每条记录一个子目录（meta.json + 原文件），删除与恢复都是单次目录级操作，不会留下半成品；
 * 条目 id 由时间戳与随机串组成并走白名单校验，不接受任何含路径分隔符的输入；
 * 彻底清除使用 useTrash: false，确保「二次清除」不再进系统回收站，与首次删除语义严格区分；
 * 恢复落点优先原笔记本，原目录已不存在时落未分类，同名冲突顺延序号，绝不覆盖既有笔记。
 */
import * as vscode from 'vscode'
import { resolveStorageRoot } from '@modules/common/config'
import { UNCLASSIFIED_NOTEBOOK_ID } from '@modules/common/db/statsRepository'
import { logger } from '@modules/common/logger'
import { buildStorageUri, isPathExisting, toSafeSegments, toStorageRelativePath } from '@modules/common/storagePath'
import { TRASH_DIR_NAME, TRASH_ITEM_ID_PATTERN, isTrashItemId } from '@shared/types/trash'
import type {
    RestoredNote,
    TrashClearResult,
    TrashFailure,
    TrashItem,
    TrashPurgeResult,
    TrashRestoreResult,
} from '@shared/types/trash'

/** 每条记录内的元数据文件名：与原笔记同目录存放，恢复时据此还原归属 */
const META_FILE_NAME = 'meta.json'

/** 笔记扩展名：恢复时只认 Markdown，避免把误入回收站的其它文件当笔记恢复 */
const NOTE_EXTENSION = '.md'

/** 同名冲突的最大顺延次数，超出即放弃该条恢复 */
const MAX_RESTORE_ATTEMPTS = 50

/** 回收站元数据：记录删除前的归属，恢复时按此还原 */
interface TrashMeta {
    originalPath: string
    notebookId: string
    notebookName: string
    title: string
    deletedAt: string
}

/** 入站笔记：调用方已按索引库校验过存在性 */
export interface TrashEntryInput {
    /** 原笔记的相对存储根路径 */
    indexPath: string
    /** 原所属笔记本 id */
    notebookId: string
    /** 原所属笔记本展示名 */
    notebookName: string
    /** 笔记标题 */
    title: string
}

/** 回收站所需的索引能力：恢复后主动收敛，不依赖 watcher 的创建回调 */
export interface TrashIndexer {
    indexFile: (uri: vscode.Uri) => Promise<void>
}

/** 生成回收站条目 id：年月日-时分秒-随机串，落在 isTrashItemId 的白名单内 */
function buildTrashId(now: Date): string {
    const pad = (value: number): string => String(value).padStart(2, '0')
    const stamp = [
        `${String(now.getFullYear())}${pad(now.getMonth() + 1)}${pad(now.getDate())}`,
        `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`,
    ].join('-')
    return `${stamp}-${Math.random().toString(36).slice(2, 6)}`
}

/** 把异常收敛成单行文案：失败明细要能直接展示给用户 */
function toCauseMessage(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause)
}

/** 解析元数据：字段类型全部校验，任一不符即视为损坏记录 */
function readMeta(value: unknown): TrashMeta | null {
    if (typeof value !== 'object' || value === null) {
        return null
    }
    const candidate = value as Record<string, unknown>
    const fields: (keyof TrashMeta)[] = ['originalPath', 'notebookId', 'notebookName', 'title', 'deletedAt']
    if (fields.some((field) => typeof candidate[field] !== 'string')) {
        return null
    }
    return {
        originalPath: candidate.originalPath as string,
        notebookId: candidate.notebookId as string,
        notebookName: candidate.notebookName as string,
        title: candidate.title as string,
        deletedAt: candidate.deletedAt as string,
    }
}

export class TrashStore {
    public constructor(private readonly indexer: TrashIndexer) {}

    /** 回收站根目录 Uri */
    private trashRootUri(): vscode.Uri {
        return buildStorageUri(resolveStorageRoot(), [TRASH_DIR_NAME])
    }

    /** 单条记录目录 Uri：id 由本模块生成，调用方传入时须先经白名单校验 */
    private itemUri(id: string): vscode.Uri {
        return buildStorageUri(resolveStorageRoot(), [TRASH_DIR_NAME, id])
    }

    /**
     * 把一篇笔记移入回收站：写元数据后整文件搬移，失败时回滚已建的记录目录。
     * 关键约束：调用方须已确认路径在索引库内且文件有未保存修改时拒绝删除；
     * 搬移失败必须抛错，由上层把该条记入 failures，避免列表显示已删除而磁盘仍在原处。
     */
    public async moveToTrash(entry: TrashEntryInput): Promise<string> {
        const root = resolveStorageRoot()
        const segments = toSafeSegments(toStorageRelativePath(entry.indexPath, '笔记'), '笔记')
        const fileName = segments[segments.length - 1] ?? ''
        const sourceUri = buildStorageUri(root, segments)
        const id = buildTrashId(new Date())
        const itemUri = this.itemUri(id)
        const meta: TrashMeta = {
            originalPath: segments.join('/'),
            notebookId: entry.notebookId,
            notebookName: entry.notebookName,
            title: entry.title,
            deletedAt: new Date().toISOString(),
        }
        await vscode.workspace.fs.createDirectory(itemUri)
        try {
            await vscode.workspace.fs.writeFile(
                buildStorageUri(root, [TRASH_DIR_NAME, id, META_FILE_NAME]),
                new TextEncoder().encode(JSON.stringify(meta)),
            )
            await vscode.workspace.fs.rename(sourceUri, buildStorageUri(root, [TRASH_DIR_NAME, id, fileName]), {
                overwrite: false,
            })
        } catch (cause) {
            // 半成品记录会让回收站出现无正文的条目，失败即整目录清掉
            await vscode.workspace.fs.delete(itemUri, { recursive: true, useTrash: false }).then(
                () => undefined,
                () => undefined,
            )
            throw cause
        }
        logger.info(`笔记已移入回收站：${entry.indexPath} → ${TRASH_DIR_NAME}/${id}`)
        return id
    }

    /** 列出回收站条目：按删除时间倒序，损坏记录跳过并记日志 */
    public async list(): Promise<TrashItem[]> {
        const entries = await this.readDirectorySafe(this.trashRootUri())
        const items: TrashItem[] = []
        for (const [name, fileType] of entries) {
            if (fileType !== vscode.FileType.Directory || !isTrashItemId(name)) {
                continue
            }
            const meta = await this.readMetaSafe(name)
            if (meta === null) {
                logger.warn(`回收站记录损坏，已跳过：${TRASH_DIR_NAME}/${name}`)
                continue
            }
            items.push({
                id: name,
                title: meta.title,
                notebookId: meta.notebookId,
                notebookName: meta.notebookName,
                deletedAt: meta.deletedAt,
                originalPath: meta.originalPath,
            })
        }
        return items.sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : a.deletedAt > b.deletedAt ? -1 : 0))
    }

    /**
     * 恢复条目：按元数据搬回原笔记本，原目录不存在时落未分类，同名冲突顺延。
     * 关键约束：单条失败不阻断其余条目，失败原因随结果回传；
     * 恢复成功后立即索引新路径，并保留回收站记录目录到搬移完成之后再删，避免中途失败丢正文。
     */
    public async restore(ids: string[]): Promise<TrashRestoreResult> {
        const restored: RestoredNote[] = []
        const failures: TrashFailure[] = []
        for (const id of [...new Set(ids)]) {
            try {
                const result = await this.restoreOne(id)
                restored.push({ id, path: result })
            } catch (cause) {
                failures.push({ id, message: toCauseMessage(cause) })
            }
        }
        return { restored, failures }
    }

    /** 彻底删除指定条目：不再进系统回收站，条目不存在视为已清除 */
    public async purge(ids: string[]): Promise<TrashPurgeResult> {
        const purgedIds: string[] = []
        const failures: TrashFailure[] = []
        for (const id of [...new Set(ids)]) {
            // 用正则而非类型守卫判断：守卫会把已收窄为 string 的入参判成 never，反而写不进失败明细
            if (!TRASH_ITEM_ID_PATTERN.test(id)) {
                failures.push({ id, message: `回收站条目 id 非法：${id}` })
                continue
            }
            try {
                await vscode.workspace.fs.delete(this.itemUri(id), { recursive: true, useTrash: false })
                purgedIds.push(id)
            } catch (cause) {
                // 已不存在的条目按清除成功处理，保证重复清除幂等
                if (await isPathExisting(this.itemUri(id))) {
                    failures.push({ id, message: toCauseMessage(cause) })
                } else {
                    purgedIds.push(id)
                }
            }
        }
        if (purgedIds.length > 0) {
            logger.info(`回收站已彻底清除 ${String(purgedIds.length)} 条`)
        }
        return { purgedIds, failures }
    }

    /** 清空回收站：逐条彻底删除，失败条数随结果回传 */
    public async clear(): Promise<TrashClearResult> {
        const entries = await this.readDirectorySafe(this.trashRootUri())
        const ids = entries
            .filter(([name, fileType]) => fileType === vscode.FileType.Directory && isTrashItemId(name))
            .map(([name]) => name)
        if (ids.length === 0) {
            return { purgedCount: 0, failures: [] }
        }
        const result = await this.purge(ids)
        return { purgedCount: result.purgedIds.length, failures: result.failures }
    }

    /** 恢复单条：返回恢复后的相对路径 */
    private async restoreOne(id: string): Promise<string> {
        if (!TRASH_ITEM_ID_PATTERN.test(id)) {
            throw new Error(`回收站条目 id 非法：${id}`)
        }
        const meta = await this.readMetaSafe(id)
        if (meta === null) {
            throw new Error(`回收站记录缺失或损坏：${id}`)
        }
        const originalSegments = toSafeSegments(toStorageRelativePath(meta.originalPath, '笔记'), '笔记')
        const fileName = originalSegments[originalSegments.length - 1] ?? ''
        if (!fileName.toLowerCase().endsWith(NOTE_EXTENSION)) {
            throw new Error(`回收站记录不是笔记文档：${meta.originalPath}`)
        }
        const root = resolveStorageRoot()
        const sourceUri = buildStorageUri(root, [TRASH_DIR_NAME, id, fileName])
        if (!(await isPathExisting(sourceUri))) {
            throw new Error(`回收站记录缺少正文文件：${id}`)
        }
        const notebookId = await this.resolveRestoreNotebook(meta.notebookId)
        const targetDirectory = buildStorageUri(root, notebookId.split('/'))
        await vscode.workspace.fs.createDirectory(targetDirectory)
        const targetName = await this.findAvailableName(targetDirectory, fileName)
        const targetUri = buildStorageUri(root, [...notebookId.split('/'), targetName])
        await vscode.workspace.fs.rename(sourceUri, targetUri, { overwrite: false })
        await this.indexer.indexFile(targetUri)
        // 正文已搬回，回收站记录目录只剩元数据，整体清掉避免重复恢复
        await vscode.workspace.fs.delete(this.itemUri(id), { recursive: true, useTrash: false }).then(
            () => undefined,
            () => undefined,
        )
        const restoredPath = [...notebookId.split('/'), targetName].join('/')
        logger.info(`笔记已从回收站恢复：${TRASH_DIR_NAME}/${id} → ${restoredPath}`)
        return restoredPath
    }

    /** 恢复落点：原笔记本目录仍存在则原位恢复，否则落未分类 */
    private async resolveRestoreNotebook(notebookId: string): Promise<string> {
        const root = resolveStorageRoot()
        const segments = toSafeSegments(toStorageRelativePath(notebookId, '笔记本'), '笔记本')
        if (await isPathExisting(buildStorageUri(root, segments))) {
            return segments.join('/')
        }
        return UNCLASSIFIED_NOTEBOOK_ID
    }

    /** 在目标目录内找一个可用文件名：同名则顺延「标题 2」「标题 3」…… */
    private async findAvailableName(directory: vscode.Uri, fileName: string): Promise<string> {
        const base = fileName.replace(/\.md$/iu, '')
        for (let index = 1; index <= MAX_RESTORE_ATTEMPTS; index += 1) {
            const candidate = index === 1 ? fileName : `${base} ${String(index)}${NOTE_EXTENSION}`
            if (!(await isPathExisting(vscode.Uri.joinPath(directory, candidate)))) {
                return candidate
            }
        }
        throw new Error(`恢复失败：${fileName} 连续 ${String(MAX_RESTORE_ATTEMPTS)} 次重名`)
    }

    /** 读取元数据：文件缺失或解析失败一律返回 null，由调用方跳过该条 */
    private async readMetaSafe(id: string): Promise<TrashMeta | null> {
        const metaUri = buildStorageUri(resolveStorageRoot(), [TRASH_DIR_NAME, id, META_FILE_NAME])
        try {
            const content = new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(metaUri))
            return readMeta(JSON.parse(content) as unknown)
        } catch {
            return null
        }
    }

    /** 读目录：目录不存在时返回空数组，避免首次使用回收站就报错 */
    private async readDirectorySafe(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
        try {
            return await vscode.workspace.fs.readDirectory(uri)
        } catch {
            return []
        }
    }
}
