/**
 * 快照存储层：把一版 README、设定、角色设定与大纲的原文复制到 press/{作品名}/Snapshots/{快照标识}/，
 * 并在同目录写 meta.json 记录来源、触发范围与各文件哈希，供列表与恢复读取。
 * 复用约定：存储根解析取 common/config，路径拼装与片段校验取 common/storagePath；正文与元信息分开放，
 * 列表只读 meta.json，正文本地按需读取，避免一次列出几十版就把整部作品搬进内存。
 * 关键约束：目录名必须匹配 PRESS_SNAPSHOT_ID_PATTERN 且由宿主拼接，前端传入的标识只用于比对；
 * 四份文档始终整份写入（含空串），空内容也要能还原；同内容靠哈希去重，重复写入由调用方跳过；
 * Snapshots 目录必须在索引排除名单内，否则快照副本会混进作品字数。
 */
import { createHash, randomBytes } from 'node:crypto'
import * as vscode from 'vscode'
import type {
    PressSnapshotEntry,
    PressSnapshotFileKey,
    PressSnapshotReason,
    PressSnapshotTrigger,
    PressWorkspaceFiles,
} from '../../../shared/types/press'
import { PRESS_SNAPSHOT_DIR, isPressSnapshotId } from '../../../shared/types/press'
import { resolveStorageRoot } from '../../common/config'
import { logger } from '../../common/logger'
import { PRESS_MODULE_DIR } from '../../common/projectPath'
import { buildStorageUri, isPathExisting, toSafeSegments } from '../../common/storagePath'
import { PROJECT_README_NAME } from '../projectFactory'

/** 快照收录的文档键：顺序固定，写入与读取共用，避免各处顺序不一致导致对照错位 */
export const SNAPSHOT_FILE_KEYS: readonly PressSnapshotFileKey[] = ['readme', 'setting', 'characters', 'outline']

/** 文档键到文件名：与 projectWorkspace 的读取口径保持一致 */
const SNAPSHOT_FILE_NAMES: Readonly<Record<PressSnapshotFileKey, string>> = {
    readme: PROJECT_README_NAME,
    setting: '设定.md',
    characters: '角色设定.md',
    outline: '大纲.md',
}

/** 元信息文件名 */
const META_FILE_NAME = 'meta.json'

/** 快照目录内的 .gitignore 内容：整目录忽略，避免存储根落在代码仓库时被提交 */
const GITIGNORE_CONTENT = '*\n'

/** 作品目录段数：press/{作品名} */
const PROJECT_DIR_DEPTH = 2

/** meta.json 结构：version 供后续格式演进，缺失或不匹配时按损坏跳过 */
interface SnapshotMetaFile {
    version: 1
    createdAt: string
    reason: PressSnapshotReason
    trigger: PressSnapshotTrigger[]
    label: string
    sizeBytes: number
    hashes: Record<PressSnapshotFileKey, string>
}

/** 带哈希的内部条目：对外下发前会剥掉 hashes */
export interface StoredSnapshot extends PressSnapshotEntry {
    hashes: Record<PressSnapshotFileKey, string>
}

/** 写一版快照的入参 */
export interface WriteSnapshotInput {
    dirPath: string
    files: PressWorkspaceFiles
    reason: PressSnapshotReason
    trigger: PressSnapshotTrigger[]
    label?: string
}

/**
 * 解析作品目录为合法的两段片段：与 projectWorkspace 同口径，拒绝上跳、盘符与更深层级。
 * 关键约束：不可复用索引路径的归一化，快照目录由宿主从存储根重新拼装。
 */
export function resolveProjectName(dirPath: string): string {
    const segments = toSafeSegments(dirPath, '作品')
    if (segments.length !== PROJECT_DIR_DEPTH || segments[0] !== PRESS_MODULE_DIR) {
        throw new Error(`作品目录非法：${dirPath}`)
    }
    return segments[1] ?? ''
}

/** 拼装快照相关 Uri：标识为空串时即 Snapshots 目录本身，章节时间线也从这里分叉 */
export function snapshotUri(dirPath: string, ...segments: string[]): vscode.Uri {
    const name = resolveProjectName(dirPath)
    return buildStorageUri(resolveStorageRoot(), [PRESS_MODULE_DIR, name, PRESS_SNAPSHOT_DIR, ...segments])
}

/** 计算文本的 SHA-256：内容寻址的比较基准，同内容即视为未变更 */
export function hashText(content: string): string {
    return createHash('sha256').update(content, 'utf8').digest('hex')
}

/** 计算四份文档的哈希表 */
export function hashWorkspaceFiles(files: PressWorkspaceFiles): Record<PressSnapshotFileKey, string> {
    return {
        readme: hashText(files.readme),
        setting: hashText(files.setting),
        characters: hashText(files.characters),
        outline: hashText(files.outline),
    }
}

/** 生成快照标识：本地时间 14 位 + 6 位随机十六进制，同秒多次创建也不会撞名 */
export function createSnapshotId(now: Date): string {
    const pad = (value: number): string => String(value).padStart(2, '0')
    const stamp = [
        String(now.getFullYear()),
        pad(now.getMonth() + 1),
        pad(now.getDate()),
        '-',
        pad(now.getHours()),
        pad(now.getMinutes()),
        pad(now.getSeconds()),
    ].join('')
    return `${stamp}-${randomBytes(3).toString('hex')}`
}

/** 读文本文件：不存在或解码失败返回 null，由调用方决定是跳过还是按空处理 */
export async function readTextFile(uri: vscode.Uri): Promise<string | null> {
    try {
        const content = await vscode.workspace.fs.readFile(uri)
        return new TextDecoder('utf-8').decode(content)
    } catch {
        return null
    }
}

/** 写文本文件：统一 UTF-8，覆盖语义由调用方保证 */
export async function writeTextFile(uri: vscode.Uri, content: string): Promise<void> {
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content))
}

/** 解析并校验 meta.json：字段缺失或版本不符时返回 null，单条损坏不影响其它版本列出 */
function parseMeta(raw: string): SnapshotMetaFile | null {
    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        return null
    }
    if (typeof parsed !== 'object' || parsed === null) {
        return null
    }
    const meta = parsed as Partial<SnapshotMetaFile>
    if (meta.version !== 1 || typeof meta.createdAt !== 'string') {
        return null
    }
    const hashes = meta.hashes
    if (typeof hashes !== 'object' || hashes === null) {
        return null
    }
    const isValidHashes = SNAPSHOT_FILE_KEYS.every((key) => typeof hashes[key] === 'string')
    if (!isValidHashes) {
        return null
    }
    return {
        version: 1,
        createdAt: meta.createdAt,
        reason: meta.reason === 'manual' || meta.reason === 'restore' ? meta.reason : 'auto',
        trigger: Array.isArray(meta.trigger) ? meta.trigger.filter(isTrigger) : [],
        label: typeof meta.label === 'string' ? meta.label : '',
        sizeBytes: typeof meta.sizeBytes === 'number' && Number.isFinite(meta.sizeBytes) ? meta.sizeBytes : 0,
        hashes: {
            readme: hashes.readme,
            setting: hashes.setting,
            characters: hashes.characters,
            outline: hashes.outline,
        },
    }
}

/** 触发范围白名单：meta 被手工编辑时也不能带出非法字段 */
function isTrigger(value: unknown): value is PressSnapshotTrigger {
    return value === 'setting' || value === 'characters' || value === 'outline'
}

/** 首次写入时补一份 .gitignore：存储根落在代码仓库时，快照不应进入版本库 */
export async function ensureGitignore(dirPath: string): Promise<void> {
    const uri = vscode.Uri.joinPath(snapshotUri(dirPath), '.gitignore')
    if (await isPathExisting(uri)) {
        return
    }
    try {
        await writeTextFile(uri, GITIGNORE_CONTENT)
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.warn(`快照目录 .gitignore 写入失败（不影响快照本身）：${uri.fsPath}（${message}）`)
    }
}

/** 写一版快照：四份文档整份落盘，随后写 meta 并补 .gitignore */
export async function writeSnapshot(input: WriteSnapshotInput): Promise<StoredSnapshot> {
    const now = new Date()
    const id = createSnapshotId(now)
    const createdAt = now.toISOString()
    const hashes = hashWorkspaceFiles(input.files)
    const dirUri = snapshotUri(input.dirPath, id)
    await vscode.workspace.fs.createDirectory(dirUri)
    let sizeBytes = 0
    for (const key of SNAPSHOT_FILE_KEYS) {
        const bytes = new TextEncoder().encode(input.files[key])
        sizeBytes += bytes.byteLength
        await writeTextFile(vscode.Uri.joinPath(dirUri, SNAPSHOT_FILE_NAMES[key]), input.files[key])
    }
    const meta: SnapshotMetaFile = {
        version: 1,
        createdAt,
        reason: input.reason,
        trigger: input.trigger,
        label: input.label ?? '',
        sizeBytes,
        hashes,
    }
    await writeTextFile(vscode.Uri.joinPath(dirUri, META_FILE_NAME), `${JSON.stringify(meta, null, 2)}\n`)
    await ensureGitignore(input.dirPath)
    return {
        id,
        createdAt,
        reason: meta.reason,
        trigger: meta.trigger,
        label: meta.label,
        changed: [...SNAPSHOT_FILE_KEYS],
        sizeBytes,
        hashes,
    }
}

/** 列出目录下的快照子目录名：目录不存在（从未写过快照）按空数组处理 */
async function listSnapshotIds(dirPath: string): Promise<string[]> {
    let entries: [string, vscode.FileType][]
    try {
        entries = await vscode.workspace.fs.readDirectory(snapshotUri(dirPath))
    } catch {
        return []
    }
    return entries
        .filter(([name, type]) => type === vscode.FileType.Directory && isPressSnapshotId(name))
        .map(([name]) => name)
}

/**
 * 列出全部快照（按创建时间倒序），并算出每版相对上一版的变动文档。
 * 关键约束：与更早一版比对而非更晚一版——越新的一版 changed 表示「这一版改了什么」；
 * 最早一版没有可比对象，changed 记为收录的全部文档。
 */
export async function listStoredSnapshots(dirPath: string): Promise<StoredSnapshot[]> {
    const ids = await listSnapshotIds(dirPath)
    const rows: StoredSnapshot[] = []
    for (const id of ids) {
        const raw = await readTextFile(vscode.Uri.joinPath(snapshotUri(dirPath, id), META_FILE_NAME))
        if (raw === null) {
            continue
        }
        const meta = parseMeta(raw)
        if (meta === null) {
            logger.warn(`快照 meta 损坏，已跳过：${dirPath}/${id}`)
            continue
        }
        rows.push({
            id,
            createdAt: meta.createdAt,
            reason: meta.reason,
            trigger: meta.trigger,
            label: meta.label,
            changed: [],
            sizeBytes: meta.sizeBytes,
            hashes: meta.hashes,
        })
    }
    rows.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
    return rows.map((row, index) => {
        const older = rows[index + 1]
        const changed =
            older === undefined
                ? [...SNAPSHOT_FILE_KEYS]
                : SNAPSHOT_FILE_KEYS.filter((key) => row.hashes[key] !== older.hashes[key])
        return { ...row, changed }
    })
}

/** 对外条目：剥掉 hashes，避免把四段 64 位摘要塞进 Webview 消息 */
export function toSnapshotEntry(snapshot: StoredSnapshot): PressSnapshotEntry {
    return {
        id: snapshot.id,
        createdAt: snapshot.createdAt,
        reason: snapshot.reason,
        trigger: snapshot.trigger,
        label: snapshot.label,
        changed: snapshot.changed,
        sizeBytes: snapshot.sizeBytes,
    }
}

/** 读某一版的指定文档：缺文件按空串返回，让「恢复到空内容」同样成立 */
export async function readSnapshotFiles(
    dirPath: string,
    snapshotId: string,
    keys: readonly PressSnapshotFileKey[],
): Promise<Partial<Record<PressSnapshotFileKey, string>>> {
    const dirUri = snapshotUri(dirPath, snapshotId)
    const result: Partial<Record<PressSnapshotFileKey, string>> = {}
    for (const key of keys) {
        const content = await readTextFile(vscode.Uri.joinPath(dirUri, SNAPSHOT_FILE_NAMES[key]))
        result[key] = content ?? ''
    }
    return result
}

/** 删除一版：只删该目录，保留其它版本 */
export async function deleteSnapshotDir(dirPath: string, snapshotId: string): Promise<boolean> {
    const uri = snapshotUri(dirPath, snapshotId)
    if (!(await isPathExisting(uri))) {
        return false
    }
    await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: false })
    return true
}
