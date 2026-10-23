/**
 * 章节快照存储层：按「一章一条时间线」保存正文历史，落在 press/{作品名}/Snapshots/Chapters/{卷?}/{章}/。
 * 复用约定：路径拼装与片段校验复用 snapshotStore 的 snapshotUri 与 storagePath 的 toSafeSegments，
 * 标识生成与哈希复用同一份实现；章节正文与元信息同名成对存放（{id}.md + {id}.json），单版损坏不影响其它版本。
 * 关键约束：章目录下不再嵌套版本目录，避免一章产生几十个子目录；
 * 章节路径必须落在该作品的 Chapters 目录内且以 .md 结尾，卷层级最多一层；
 * 清理按「近期版数 + 每日首版」执行，手动与恢复前留底不参与自动清理。
 */
import * as vscode from 'vscode'
import {
    createSnapshotId,
    ensureGitignore,
    hashText,
    readTextFile,
    resolveProjectName,
    snapshotUri,
    writeTextFile,
} from './snapshotStore'
import type { ChapterSnapshotEntry, ChapterSnapshotReason, ChapterSnapshotSummary } from '../../../shared/types/press'
import { logger } from '../../common/logger'
import { isPathExisting, toSafeSegments } from '../../common/storagePath'
import { PROJECT_CHAPTER_DIR, PRESS_MODULE_DIR } from '../projectFactory'

/** 章节时间线根目录名：与结构化文档的整版快照目录并列 */
export const CHAPTER_SNAPSHOT_DIR = PROJECT_CHAPTER_DIR

/** 元信息文件名 */
const META_FILE_NAME = 'meta.json'

/** 近期版本保留数：单章回退通常只回溯几步 */
const KEEP_RECENT = 10

/** 每日首版保留天数：覆盖「上周那版写得好」这类回溯 */
const KEEP_DAILY_DAYS = 14

/** 单章版本硬上限：每日首版叠加后的兜底，超出时从最旧的自动版本删起 */
const MAX_VERSIONS = 20

/** 单章正文的自动快照体积上限：超长章节整份复制会失控，只允许手动留版 */
export const MAX_CHAPTER_BYTES = 2 * 1024 * 1024

/** 单版元信息：与正文同名成对，读取时按 id 配对 */
interface ChapterMetaFile {
    version: 1
    chapterPath: string
    title: string
    createdAt: string
    reason: ChapterSnapshotReason
    label: string
    sizeBytes: number
    hash: string
}

/** 带哈希的内部版本：清理与判重需要，对外下发前剥掉 */
export interface StoredChapterVersion extends ChapterSnapshotEntry {
    hash: string
}

/** 章节定位结果：目录、标题与所属卷 */
export interface ChapterTarget {
    dirUri: vscode.Uri
    title: string
    volume: string
}

/** 写一版章节快照的入参 */
export interface WriteChapterSnapshotInput {
    dirPath: string
    chapterPath: string
    content: string
    reason: ChapterSnapshotReason
    label?: string
}

/** 把章节相对路径解析为时间线目录：拒绝越权路径与过深层级 */
export function resolveChapterTarget(dirPath: string, chapterPath: string): ChapterTarget {
    const projectName = resolveProjectName(dirPath)
    const segments = toSafeSegments(chapterPath, '章节')
    if (segments.length < 4) {
        throw new Error(`章节路径非法：${chapterPath}`)
    }
    if ((segments[0] ?? '').toLowerCase() !== PRESS_MODULE_DIR) {
        throw new Error(`章节路径不在作品目录内：${chapterPath}`)
    }
    if (segments[1] !== projectName) {
        throw new Error(`章节路径不属于当前作品：${chapterPath}`)
    }
    if (segments[2] !== PROJECT_CHAPTER_DIR) {
        throw new Error(`章节路径不在 Chapters 目录内：${chapterPath}`)
    }
    const fileName = segments[segments.length - 1] ?? ''
    if (!fileName.toLowerCase().endsWith('.md')) {
        throw new Error(`章节路径不是 Markdown 文档：${chapterPath}`)
    }
    const volumeSegments = segments.slice(3, segments.length - 1)
    if (volumeSegments.length > 1) {
        throw new Error(`章节层级过深：${chapterPath}`)
    }
    const title = fileName.replace(/\.md$/iu, '')
    if (title.length === 0) {
        throw new Error(`章节文件名非法：${chapterPath}`)
    }
    const volume = volumeSegments[0] ?? ''
    const dirUri = snapshotUri(dirPath, CHAPTER_SNAPSHOT_DIR, ...volumeSegments, title)
    return { dirUri, title, volume }
}

/** 解析元信息：字段缺失或版本不符返回 null，单条损坏不影响同章其它版本 */
function parseMeta(raw: string): ChapterMetaFile | null {
    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        return null
    }
    if (typeof parsed !== 'object' || parsed === null) {
        return null
    }
    const meta = parsed as Partial<ChapterMetaFile>
    if (meta.version !== 1 || typeof meta.createdAt !== 'string' || typeof meta.chapterPath !== 'string') {
        return null
    }
    const reason: ChapterSnapshotReason =
        meta.reason === 'ai-write' || meta.reason === 'manual' || meta.reason === 'restore' ? meta.reason : 'auto'
    return {
        version: 1,
        chapterPath: meta.chapterPath,
        title: typeof meta.title === 'string' ? meta.title : '',
        createdAt: meta.createdAt,
        reason,
        label: typeof meta.label === 'string' ? meta.label : '',
        sizeBytes: typeof meta.sizeBytes === 'number' && Number.isFinite(meta.sizeBytes) ? meta.sizeBytes : 0,
        hash: typeof meta.hash === 'string' ? meta.hash : '',
    }
}

/** 列出章节目录下的版本 id：以 .json 元信息为准，正文缺失的版本不参与列表 */
async function listVersionIds(target: ChapterTarget): Promise<string[]> {
    let entries: [string, vscode.FileType][]
    try {
        entries = await vscode.workspace.fs.readDirectory(target.dirUri)
    } catch {
        return []
    }
    return entries
        .filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.json') && name !== META_FILE_NAME)
        .map(([name]) => name.slice(0, -'.json'.length))
}

/** 读该章全部版本（按创建时间倒序） */
export async function listChapterVersions(
    dirPath: string,
    chapterPath: string,
): Promise<StoredChapterVersion[]> {
    const target = resolveChapterTarget(dirPath, chapterPath)
    const ids = await listVersionIds(target)
    const versions: StoredChapterVersion[] = []
    for (const id of ids) {
        const raw = await readTextFile(vscode.Uri.joinPath(target.dirUri, `${id}.json`))
        if (raw === null) {
            continue
        }
        const meta = parseMeta(raw)
        if (meta === null) {
            logger.warn(`章节快照元信息损坏，已跳过：${chapterPath}/${id}`)
            continue
        }
        versions.push({
            id,
            chapterPath: meta.chapterPath,
            title: meta.title.length > 0 ? meta.title : target.title,
            createdAt: meta.createdAt,
            reason: meta.reason,
            label: meta.label,
            sizeBytes: meta.sizeBytes,
            hash: meta.hash,
        })
    }
    versions.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
    return versions
}

/** 对外条目：剥掉哈希 */
export function toChapterEntry(version: StoredChapterVersion): ChapterSnapshotEntry {
    return {
        id: version.id,
        chapterPath: version.chapterPath,
        title: version.title,
        createdAt: version.createdAt,
        reason: version.reason,
        label: version.label,
        sizeBytes: version.sizeBytes,
    }
}

/** 写一版章节快照：正文与元信息同名成对落盘 */
export async function writeChapterSnapshot(input: WriteChapterSnapshotInput): Promise<StoredChapterVersion> {
    const target = resolveChapterTarget(input.dirPath, input.chapterPath)
    const bytes = new TextEncoder().encode(input.content)
    if (bytes.byteLength > MAX_CHAPTER_BYTES) {
        throw new Error(`章节超过 ${MAX_CHAPTER_BYTES} 字节，已跳过快照：${input.chapterPath}`)
    }
    const now = new Date()
    const id = createSnapshotId(now)
    const createdAt = now.toISOString()
    await vscode.workspace.fs.createDirectory(target.dirUri)
    await writeTextFile(vscode.Uri.joinPath(target.dirUri, `${id}.md`), input.content)
    const meta: ChapterMetaFile = {
        version: 1,
        chapterPath: input.chapterPath,
        title: target.title,
        createdAt,
        reason: input.reason,
        label: input.label?.trim().slice(0, 60) ?? '',
        sizeBytes: bytes.byteLength,
        hash: hashText(input.content),
    }
    await writeTextFile(vscode.Uri.joinPath(target.dirUri, `${id}.json`), `${JSON.stringify(meta, null, 2)}\n`)
    await ensureGitignore(input.dirPath)
    return {
        id,
        chapterPath: meta.chapterPath,
        title: meta.title,
        createdAt,
        reason: meta.reason,
        label: meta.label,
        sizeBytes: meta.sizeBytes,
        hash: meta.hash,
    }
}

/** 读某一版正文：缺失按空串处理，让「恢复到空章节」同样成立 */
export async function readChapterVersion(
    dirPath: string,
    chapterPath: string,
    snapshotId: string,
): Promise<string> {
    const target = resolveChapterTarget(dirPath, chapterPath)
    const content = await readTextFile(vscode.Uri.joinPath(target.dirUri, `${snapshotId}.md`))
    return content ?? ''
}

/** 删一版：正文与元信息一同删除 */
export async function deleteChapterVersion(
    dirPath: string,
    chapterPath: string,
    snapshotId: string,
): Promise<boolean> {
    const target = resolveChapterTarget(dirPath, chapterPath)
    const mdUri = vscode.Uri.joinPath(target.dirUri, `${snapshotId}.md`)
    const jsonUri = vscode.Uri.joinPath(target.dirUri, `${snapshotId}.json`)
    const hasBody = await isPathExisting(mdUri)
    const hasMeta = await isPathExisting(jsonUri)
    if (!hasBody && !hasMeta) {
        return false
    }
    if (hasBody) {
        await vscode.workspace.fs.delete(mdUri, { recursive: false, useTrash: false })
    }
    if (hasMeta) {
        await vscode.workspace.fs.delete(jsonUri, { recursive: false, useTrash: false })
    }
    return true
}

/** 收集章节目录：以「含 json 元信息」判定为一条章节时间线，最多下探一层卷目录 */
async function collectVersionDirs(dirUri: vscode.Uri, depth: number): Promise<vscode.Uri[]> {
    let entries: [string, vscode.FileType][]
    try {
        entries = await vscode.workspace.fs.readDirectory(dirUri)
    } catch {
        return []
    }
    const hasMeta = entries.some(([name, type]) => type === vscode.FileType.File && name.endsWith('.json'))
    if (hasMeta) {
        return [dirUri]
    }
    if (depth <= 0) {
        return []
    }
    const result: vscode.Uri[] = []
    for (const [name, type] of entries) {
        if (type !== vscode.FileType.Directory) {
            continue
        }
        const child = vscode.Uri.joinPath(dirUri, name)
        result.push(...(await collectVersionDirs(child, depth - 1)))
    }
    return result
}

/** 列出所有有快照的章节：按最近留版时间倒序 */
export async function listChapterSummaries(dirPath: string): Promise<ChapterSnapshotSummary[]> {
    const rootUri = snapshotUri(dirPath, CHAPTER_SNAPSHOT_DIR)
    // 下探两层：Chapters/{章} 与 Chapters/{卷}/{章}，再深即超出本章节结构约定
    const dirs = await collectVersionDirs(rootUri, 2)
    const summaries: ChapterSnapshotSummary[] = []
    for (const dirUri of dirs) {
        let entries: [string, vscode.FileType][]
        try {
            entries = await vscode.workspace.fs.readDirectory(dirUri)
        } catch {
            continue
        }
        const metaNames = entries
            .filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.json'))
            .map(([name]) => name)
        let latest: ChapterMetaFile | null = null
        for (const name of metaNames) {
            const raw = await readTextFile(vscode.Uri.joinPath(dirUri, name))
            if (raw === null) {
                continue
            }
            const meta = parseMeta(raw)
            if (meta === null) {
                continue
            }
            if (latest === null || meta.createdAt > latest.createdAt) {
                latest = meta
            }
        }
        if (latest === null) {
            continue
        }
        const segments = latest.chapterPath.split('/')
        summaries.push({
            chapterPath: latest.chapterPath,
            title: latest.title,
            volume: segments.length > 4 ? (segments[3] ?? '') : '',
            versionCount: metaNames.length,
            latestAt: latest.createdAt,
        })
    }
    summaries.sort((left, right) => right.latestAt.localeCompare(left.latestAt))
    return summaries
}

/**
 * 清理章节历史：近 KEEP_RECENT 版全留，更早的只保留每日首版且不超过 KEEP_DAILY_DAYS 天，
 * 超过 MAX_VERSIONS 时从最旧的自动版本删起。
 * 关键约束：manual 与 restore 永不自动清理，用户主动留的版本必须一直在。
 */
export async function pruneChapterVersions(dirPath: string, chapterPath: string): Promise<void> {
    const versions = await listChapterVersions(dirPath, chapterPath)
    const keptDays = new Set<string>()
    const deadline = Date.now() - KEEP_DAILY_DAYS * 24 * 60 * 60 * 1000
    const kept: StoredChapterVersion[] = []
    for (const [index, version] of versions.entries()) {
        if (version.reason === 'manual' || version.reason === 'restore') {
            kept.push(version)
            continue
        }
        if (index < KEEP_RECENT) {
            kept.push(version)
            continue
        }
        const day = version.createdAt.slice(0, 10)
        const timestamp = Date.parse(version.createdAt)
        const isRecent = Number.isFinite(timestamp) && timestamp >= deadline
        if (isRecent && !keptDays.has(day)) {
            keptDays.add(day)
            kept.push(version)
            continue
        }
        await safeDelete(dirPath, chapterPath, version.id)
    }
    const overflow = kept.length - MAX_VERSIONS
    if (overflow > 0) {
        const removable = kept
            .filter((version) => version.reason === 'auto' || version.reason === 'ai-write')
            .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
            .slice(0, overflow)
        for (const version of removable) {
            await safeDelete(dirPath, chapterPath, version.id)
        }
    }
}

/** 删除兜底：单版删除失败只记日志，不打断整轮清理 */
async function safeDelete(dirPath: string, chapterPath: string, snapshotId: string): Promise<void> {
    try {
        await deleteChapterVersion(dirPath, chapterPath, snapshotId)
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.warn(`章节快照清理失败：${chapterPath}/${snapshotId}（${message}）`)
    }
}
