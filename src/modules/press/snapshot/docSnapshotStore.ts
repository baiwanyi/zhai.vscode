/**
 * 单文件快照存储层：把一份 Markdown 的正文按版本复制到 {存储根}/Snapshots/docs/{文档目录}/{文件名}/{id}.md，
 * 并在同名 .json 里记录来源、备注与哈希，笔记、公众号文章与散落 md 共用这一条时间线。
 * 复用约定：标识生成、哈希与文本读写复用 snapshotStore 的实现，路径片段校验与 Uri 拼装取 common/storagePath，
 * 正文与元信息同名成对存放，单版损坏不影响同文档的其它版本。
 * 关键约束：只接受存储根内、以 .md 结尾的相对路径，绝对路径与上跳片段一律拒绝；
 * 快照目录必须落在 Snapshots 下——索引排除与 .gitignore 都靠这个目录名，改名会让副本混进检索与提交。
 */
import * as vscode from 'vscode'
import { resolveStorageRoot } from '@modules/common/config'
import { logger } from '@modules/common/logger'
import { buildStorageUri, isPathExisting, toSafeSegments } from '@modules/common/storagePath'
import { PRESS_SNAPSHOT_DIR } from '@shared/types/press'
import type { DocSnapshotEntry, DocSnapshotReason } from '@shared/types/snapshot'
import { createSnapshotId, hashText, readTextFile, writeTextFile } from './snapshotStore'

/** 单文件快照在 Snapshots 下的子目录：与作品整版、章节时间线并列，互不干扰 */
export const DOC_SNAPSHOT_DIR = 'docs'

/** 元信息文件名（版本元信息本身，不作为版本条目） */
const META_FILE_NAME = 'meta.json'

/** 近期版本保留数：单文档回溯通常只走几步 */
const KEEP_RECENT = 10

/** 每日首版保留天数：覆盖「上周那版写得好」这类回溯 */
const KEEP_DAILY_DAYS = 14

/** 版本数量硬上限：每日首版叠加后的兜底，超出时从最旧的自动版本删起 */
const MAX_VERSIONS = 20

/** 单份正文的自动快照体积上限：超长文档整份复制会失控，只允许手动留版 */
export const MAX_DOC_BYTES = 2 * 1024 * 1024

/** 一版元信息：与正文同名成对，读取时按 id 配对 */
interface DocMetaFile {
    version: 1
    docPath: string
    title: string
    createdAt: string
    reason: DocSnapshotReason
    label: string
    sizeBytes: number
    hash: string
}

/** 带哈希的内部版本：清理与判重需要，对外下发前剥掉 */
export interface StoredDocVersion extends DocSnapshotEntry {
    hash: string
}

/** 单文档定位结果：时间线目录与标题 */
export interface DocTarget {
    dirUri: vscode.Uri
    title: string
}

/** 写一版单文件快照的入参 */
export interface WriteDocSnapshotInput {
    docPath: string
    content: string
    reason: DocSnapshotReason
    label?: string
}

/**
 * 把文档相对路径解析为时间线目录：目录按文档所在层级展开，末级是文件名本身。
 * 关键约束：路径先过片段校验（拒绝上跳、盘符与反斜杠），只允许 .md，
 * 目录固定拼到 Snapshots/docs 下，永不接受调用方给出的绝对路径。
 */
export function resolveDocTarget(docPath: string): DocTarget {
    const segments = toSafeSegments(docPath, '文档')
    const fileName = segments[segments.length - 1] ?? ''
    if (!fileName.toLowerCase().endsWith('.md')) {
        throw new Error(`文档路径不是 Markdown：${docPath}`)
    }
    const title = fileName.replace(/\.md$/iu, '')
    if (title.length === 0) {
        throw new Error(`文档文件名非法：${docPath}`)
    }
    const dirUri = buildStorageUri(resolveStorageRoot(), [
        PRESS_SNAPSHOT_DIR,
        DOC_SNAPSHOT_DIR,
        ...segments.slice(0, -1),
        title,
    ])
    return { dirUri, title }
}

/** 解析元信息：字段缺失或版本不符返回 null，单条损坏不影响同文档其它版本 */
function parseMeta(raw: string): DocMetaFile | null {
    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        return null
    }
    if (typeof parsed !== 'object' || parsed === null) {
        return null
    }
    const meta = parsed as Partial<DocMetaFile>
    if (meta.version !== 1 || typeof meta.createdAt !== 'string' || typeof meta.docPath !== 'string') {
        return null
    }
    const reason: DocSnapshotReason =
        meta.reason === 'ai-write' || meta.reason === 'manual' || meta.reason === 'restore' || meta.reason === 'push'
            ? meta.reason
            : 'auto'
    return {
        version: 1,
        docPath: meta.docPath,
        title: typeof meta.title === 'string' ? meta.title : '',
        createdAt: meta.createdAt,
        reason,
        label: typeof meta.label === 'string' ? meta.label : '',
        sizeBytes: typeof meta.sizeBytes === 'number' && Number.isFinite(meta.sizeBytes) ? meta.sizeBytes : 0,
        hash: typeof meta.hash === 'string' ? meta.hash : '',
    }
}

/** 列出该文档目录下的版本 id：以 .json 元信息为准，正文缺失的版本不参与列表 */
async function listVersionIds(target: DocTarget): Promise<string[]> {
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

/** 读该文档全部版本（按创建时间倒序） */
export async function listDocVersions(docPath: string): Promise<StoredDocVersion[]> {
    const target = resolveDocTarget(docPath)
    const ids = await listVersionIds(target)
    const versions: StoredDocVersion[] = []
    for (const id of ids) {
        const raw = await readTextFile(vscode.Uri.joinPath(target.dirUri, `${id}.json`))
        if (raw === null) {
            continue
        }
        const meta = parseMeta(raw)
        if (meta === null) {
            logger.warn(`单文件快照元信息损坏，已跳过：${docPath}/${id}`)
            continue
        }
        versions.push({
            id,
            docPath: meta.docPath,
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
export function toDocEntry(version: StoredDocVersion): DocSnapshotEntry {
    return {
        id: version.id,
        docPath: version.docPath,
        title: version.title,
        createdAt: version.createdAt,
        reason: version.reason,
        label: version.label,
        sizeBytes: version.sizeBytes,
    }
}

/**
 * 写一版单文件快照：正文与元信息同名成对落盘。
 * 关键约束：首版写入时顺带落下 Snapshots 根目录的 .gitignore——存储根常在代码仓库里，
 * 副本不该被提交；已存在时不覆盖，交给用户自行决定。
 */
export async function writeDocSnapshot(input: WriteDocSnapshotInput): Promise<StoredDocVersion> {
    const target = resolveDocTarget(input.docPath)
    const bytes = new TextEncoder().encode(input.content)
    if (bytes.byteLength > MAX_DOC_BYTES) {
        throw new Error(`文档超过 ${String(MAX_DOC_BYTES)} 字节，已跳过快照：${input.docPath}`)
    }
    const now = new Date()
    const id = createSnapshotId(now)
    const createdAt = now.toISOString()
    await vscode.workspace.fs.createDirectory(target.dirUri)
    await writeTextFile(vscode.Uri.joinPath(target.dirUri, `${id}.md`), input.content)
    const meta: DocMetaFile = {
        version: 1,
        docPath: input.docPath,
        title: target.title,
        createdAt,
        reason: input.reason,
        label: input.label?.trim().slice(0, 60) ?? '',
        sizeBytes: bytes.byteLength,
        hash: hashText(input.content),
    }
    await writeTextFile(vscode.Uri.joinPath(target.dirUri, `${id}.json`), `${JSON.stringify(meta, null, 2)}\n`)
    await ensureDocGitignore()
    return {
        id,
        docPath: meta.docPath,
        title: meta.title,
        createdAt,
        reason: meta.reason,
        label: meta.label,
        sizeBytes: meta.sizeBytes,
        hash: meta.hash,
    }
}

/** 读某一版正文：缺失按空串处理，让「恢复到空白文档」同样成立 */
export async function readDocVersion(docPath: string, snapshotId: string): Promise<string> {
    const target = resolveDocTarget(docPath)
    const content = await readTextFile(vscode.Uri.joinPath(target.dirUri, `${snapshotId}.md`))
    return content ?? ''
}

/** 删一版：正文与元信息一同删除 */
export async function deleteDocVersion(docPath: string, snapshotId: string): Promise<boolean> {
    const target = resolveDocTarget(docPath)
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

/**
 * 清理单文档历史：近 KEEP_RECENT 版全留，更早的只保留每日首版且不超过 KEEP_DAILY_DAYS 天。
 * 关键约束：manual、restore 与 push 永不自动清理——用户主动留的版本与推送留底都必须一直在。
 */
export async function pruneDocVersions(docPath: string): Promise<void> {
    const versions = await listDocVersions(docPath)
    const keptDays = new Set<string>()
    const deadline = Date.now() - KEEP_DAILY_DAYS * 24 * 60 * 60 * 1000
    const kept: StoredDocVersion[] = []
    for (const [index, version] of versions.entries()) {
        if (version.reason === 'manual' || version.reason === 'restore' || version.reason === 'push') {
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
        await safeDelete(docPath, version.id)
    }
    const overflow = kept.length - MAX_VERSIONS
    if (overflow > 0) {
        const removable = kept
            .filter((version) => version.reason === 'auto' || version.reason === 'ai-write')
            .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
            .slice(0, overflow)
        for (const version of removable) {
            await safeDelete(docPath, version.id)
        }
    }
}

/** 删除兜底：单版删除失败只记日志，不打断整轮清理 */
async function safeDelete(docPath: string, snapshotId: string): Promise<void> {
    try {
        await deleteDocVersion(docPath, snapshotId)
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.warn(`单文件快照清理失败：${docPath}/${snapshotId}（${message}）`)
    }
}

/** 确保 Snapshots 根目录带 .gitignore：副本不进版本库，用户已自建的 .gitignore 不覆盖 */
async function ensureDocGitignore(): Promise<void> {
    const gitignoreUri = buildStorageUri(resolveStorageRoot(), [PRESS_SNAPSHOT_DIR, '.gitignore'])
    if (await isPathExisting(gitignoreUri)) {
        return
    }
    try {
        await writeTextFile(gitignoreUri, '*\n')
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.warn(`快照目录 .gitignore 写入失败：${gitignoreUri.fsPath}（${message}）`)
    }
}
