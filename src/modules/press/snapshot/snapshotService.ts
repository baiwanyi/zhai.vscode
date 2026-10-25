/**
 * 快照服务：承接设定、角色、大纲变更后的自动留版、手动留版、整版或单份恢复与过期清理，
 * 以及章节正文的按章时间线（保存后自动留版、AI 写回前强制留底、单章恢复）。
 * 复用约定：正文读写全部委托 snapshotStore 与 chapterSnapshotStore，作品文档按 projectWorkspace 的口径成组读取；
 * 恢复后由调用方注入的索引刷新器重建字数与标签，避免面板显示旧值。
 * 关键约束：自动快照按作品或按章做「间隔节流」而非防抖——定时器只在距上一版满间隔时触发一次，
 * 后续变更只覆盖待写内容、不续期，保证连续写作时既限频又不丢最后一版；
 * 内容哈希与最新一版完全相同时直接跳过，不产生空版；恢复前一律先给当前内容留一版，防止恢复不可逆；
 * 章节恢复前必须确认该章没有未保存的编辑器修改，否则写盘会被编辑器回写覆盖。
 */
import * as vscode from 'vscode'
import {
    deleteChapterVersion,
    listChapterSummaries,
    listChapterVersions,
    pruneChapterVersions,
    readChapterVersion,
    toChapterEntry,
    writeChapterSnapshot,
} from './chapterSnapshotStore'
import {
    SNAPSHOT_FILE_KEYS,
    deleteSnapshotDir,
    hashText,
    hashWorkspaceFiles,
    listStoredSnapshots,
    readSnapshotFiles,
    readTextFile,
    resolveProjectName,
    toSnapshotEntry,
    writeSnapshot,
} from './snapshotStore'
import type { StoredSnapshot } from './snapshotStore'
import type {
    ChapterSnapshotEntry,
    ChapterSnapshotReason,
    ChapterSnapshotSummary,
    PressSnapshotEntry,
    PressSnapshotFileKey,
    PressSnapshotTrigger,
    PressWorkspaceFiles,
} from '../../../shared/types/press'
import { getZhaiConfig, resolveStorageRoot } from '../../common/config'
import { logger } from '../../common/logger'
import { PRESS_MODULE_DIR } from '../../common/projectPath'
import { buildStorageUri, toSafeSegments } from '../../common/storagePath'
import { PROJECT_CHAPTER_DIR, PROJECT_README_NAME } from '../projectFactory'
import { readProjectWorkspace } from '../projectWorkspace'

/** 自动快照保留版数：超出后按「每日首版」继续保留 */
const KEEP_RECENT = 50

/** 每日首版的保留天数：更早的自动快照全部清理 */
const KEEP_DAILY_DAYS = 90

/** 手动快照的备注上限：超出截断而非拒绝，备注不影响快照本身的价值 */
const MAX_LABEL_LENGTH = 60

/** 文档键到落盘文件名：恢复时按同一份口径写回，与 projectFactory 的骨架命名保持一致 */
const KEY_TO_FILE_NAME: Readonly<Record<PressSnapshotFileKey, string>> = {
    readme: PROJECT_README_NAME,
    setting: '设定.md',
    characters: '角色设定.md',
    outline: '大纲.md',
}

/** 与 projectWorkspace 一致的文件名映射，反向用于把「保存了哪个文件」换算成触发范围；键统一小写比较 */
const FILE_NAME_TO_KEY: ReadonlyMap<string, PressSnapshotFileKey> = new Map(
    (Object.entries(KEY_TO_FILE_NAME) as [PressSnapshotFileKey, string][]).map(([key, fileName]) => [
        fileName.toLowerCase(),
        key,
    ]),
)

/** 索引刷新能力：只要求按文件重建索引，避免与 IndexService 形成强依赖 */
export interface SnapshotIndexRefresher {
    indexFile(uri: vscode.Uri): Promise<void>
}

/** 单部作品的节流状态 */
interface ProjectSnapshotState {
    timer: NodeJS.Timeout | null
    /** 待写入的最新内容：定时器未到期期间被后续变更不断覆盖 */
    latest: { files: PressWorkspaceFiles; trigger: Set<PressSnapshotTrigger> } | null
    /** 最新一版的创建时间与哈希，首次访问时从磁盘载入 */
    lastCreatedAt: number
    lastHashes: Record<PressSnapshotFileKey, string> | null
    loaded: boolean
    /** 同一作品的快照写入串行执行，避免并发建目录与重复判断 */
    chain: Promise<void>
}

/** 单章正文的节流状态：与结构化文档分开维护，键为作品目录与章节路径的组合 */
interface ChapterState {
    timer: NodeJS.Timeout | null
    latest: { content: string; reason: ChapterSnapshotReason; label: string } | null
    lastCreatedAt: number
    lastHash: string | null
    loaded: boolean
    chain: Promise<void>
}

/** 一次保存命中的快照目标：结构化文档或章节正文 */
type SavedScope =
    | { kind: 'workspace'; dirPath: string; trigger: PressSnapshotTrigger }
    | { kind: 'chapter'; dirPath: string; chapterPath: string }

/** 比较两组哈希是否完全相同：顺序固定为四份文档，逐键比对即可 */
function isSameHashes(
    left: Record<PressSnapshotFileKey, string>,
    right: Record<PressSnapshotFileKey, string>,
): boolean {
    return SNAPSHOT_FILE_KEYS.every((key) => left[key] === right[key])
}

/** 备注归一：去首尾空白并截断，空串表示不写备注 */
function normalizeLabel(label: string | undefined): string {
    return (label ?? '').trim().slice(0, MAX_LABEL_LENGTH)
}

/** 从未知异常中取一行说明，用于日志 */
function toCauseMessage(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause)
}

export class PressSnapshotService {
    private readonly states = new Map<string, ProjectSnapshotState>()

    /** 章节正文的节流状态：键为 `${dirPath}::${chapterPath}`，一章一条独立时间线 */
    private readonly chapterStates = new Map<string, ChapterState>()

    public constructor(private readonly indexer?: SnapshotIndexRefresher) {}

    /**
     * 记录一次工作台写入：设定、角色、大纲任一份内容变化时留版。
     * @param files 写入完成后的四份文档全文（调用方已持有，无需二次读盘）
     * @param trigger 本次变更的分区，多份同时写入时取并集
     */
    public async recordWorkspaceWrite(
        dirPath: string,
        files: PressWorkspaceFiles,
        trigger: readonly PressSnapshotTrigger[],
    ): Promise<void> {
        await this.record(dirPath, files, trigger)
    }

    /**
     * 记录一次编辑器内保存：仅识别 press/{作品名}/ 下那四份文档，其它文件一律忽略。
     * 只读盘后交给统一节流入口，保证与工作台写入共用同一套去重与限频规则。
     */
    public async recordEditorSave(uri: vscode.Uri): Promise<void> {
        if (!getZhaiConfig().pressSnapshotEnabled) {
            return
        }
        const scope = this.resolveSavedScope(uri)
        if (scope === null) {
            return
        }
        try {
            if (scope.kind === 'chapter') {
                const content = await readTextFile(uri)
                if (content === null) {
                    return
                }
                await this.recordChapter(scope.dirPath, scope.chapterPath, content, 'auto')
                return
            }
            const document = await readProjectWorkspace(scope.dirPath)
            await this.record(scope.dirPath, document.files, [scope.trigger])
        } catch (error) {
            logger.warn(`编辑器保存后的快照记录失败：${uri.fsPath}（${toCauseMessage(error)}）`)
        }
    }

    /** 列出版本时间线：按创建时间倒序，仅含元信息 */
    public async list(dirPath: string): Promise<PressSnapshotEntry[]> {
        const snapshots = await listStoredSnapshots(dirPath)
        return snapshots.map(toSnapshotEntry)
    }

    /** 手动留一版：不受节流限制，立即落盘；备注为空时不写 */
    public async create(dirPath: string, label?: string): Promise<PressSnapshotEntry> {
        const document = await readProjectWorkspace(dirPath)
        const snapshot = await writeSnapshot({
            dirPath,
            files: document.files,
            reason: 'manual',
            trigger: [],
            label: normalizeLabel(label),
        })
        this.syncState(dirPath, snapshot)
        return toSnapshotEntry(snapshot)
    }

    /**
     * 恢复指定版本：files 缺省为整版恢复，指定时只覆盖这几份。
     * 关键约束：恢复前先给当前内容留一版（reason=restore），且内容完全相同时直接返回空数组，
     * 避免「点一次恢复凭空多一版」；写回后逐份重建索引，字数与标签立即跟随。
     */
    public async restore(
        dirPath: string,
        snapshotId: string,
        files?: readonly PressSnapshotFileKey[],
    ): Promise<PressSnapshotFileKey[]> {
        const snapshots = await listStoredSnapshots(dirPath)
        const target = snapshots.find((item) => item.id === snapshotId)
        if (target === undefined) {
            throw new Error(`快照不存在或已清理：${snapshotId}`)
        }
        const current = await readProjectWorkspace(dirPath)
        const keys = files === undefined ? [...SNAPSHOT_FILE_KEYS] : [...new Set(files)]
        const currentHashes = hashWorkspaceFiles(current.files)
        const isRestoreNeeded = keys.some((key) => currentHashes[key] !== target.hashes[key])
        if (!isRestoreNeeded) {
            return []
        }
        await writeSnapshot({
            dirPath,
            files: current.files,
            reason: 'restore',
            trigger: [],
        })
        const restored = await readSnapshotFiles(dirPath, snapshotId, keys)
        const name = resolveProjectName(dirPath)
        const root = resolveStorageRoot()
        const writtenUris: vscode.Uri[] = []
        for (const key of keys) {
            const uri = buildStorageUri(root, [PRESS_MODULE_DIR, name, KEY_TO_FILE_NAME[key]])
            await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(restored[key] ?? ''))
            writtenUris.push(uri)
        }
        for (const uri of writtenUris) {
            try {
                await this.indexer?.indexFile(uri)
            } catch (error) {
                logger.warn(`快照恢复后索引重建失败：${uri.fsPath}（${toCauseMessage(error)}）`)
            }
        }
        // 恢复即当前内容，缓存直接对齐恢复结果：下一次自动快照只记录其后的真实改动，
        // 而不是把刚恢复出来的这一版再存一遍
        const after = await readProjectWorkspace(dirPath)
        const state = this.stateOf(dirPath)
        state.loaded = true
        state.lastHashes = hashWorkspaceFiles(after.files)
        state.lastCreatedAt = Date.now()
        logger.info(`快照已恢复：${dirPath}/${snapshotId}，覆盖 ${keys.join('、')}`)
        return keys
    }

    /** 删除一版：只影响该目录 */
    public async remove(dirPath: string, snapshotId: string): Promise<boolean> {
        return deleteSnapshotDir(dirPath, snapshotId)
    }

    /** 列出有快照的章节：按最近留版时间倒序，供界面左侧选择 */
    public async listChapters(dirPath: string): Promise<ChapterSnapshotSummary[]> {
        return listChapterSummaries(dirPath)
    }

    /** 列出某章的版本时间线：按创建时间倒序 */
    public async listChapterVersions(dirPath: string, chapterPath: string): Promise<ChapterSnapshotEntry[]> {
        const versions = await listChapterVersions(dirPath, chapterPath)
        return versions.map(toChapterEntry)
    }

    /** 手动给某章留一版：不受间隔限制，正文取磁盘当前内容 */
    public async captureChapter(
        dirPath: string,
        chapterPath: string,
        label?: string,
    ): Promise<ChapterSnapshotEntry> {
        const uri = this.chapterUri(chapterPath)
        const content = await readTextFile(uri)
        if (content === null) {
            throw new Error(`章节文件不存在：${chapterPath}`)
        }
        const version = await writeChapterSnapshot({
            dirPath,
            chapterPath,
            content,
            reason: 'manual',
            label: normalizeLabel(label),
        })
        this.syncChapterState(this.chapterKey(dirPath, chapterPath), version.hash, version.createdAt)
        return toChapterEntry(version)
    }

    /**
     * 恢复单章：覆盖前先给当前内容留一版，内容与所选版本一致时直接返回 false。
     * 关键约束：该章在编辑器中有未保存修改时必须拒绝——此时写盘会被编辑器回写覆盖，恢复等于无效。
     */
    public async restoreChapter(dirPath: string, chapterPath: string, snapshotId: string): Promise<boolean> {
        const versions = await listChapterVersions(dirPath, chapterPath)
        const target = versions.find((item) => item.id === snapshotId)
        if (target === undefined) {
            throw new Error(`章节快照不存在或已清理：${snapshotId}`)
        }
        const uri = this.chapterUri(chapterPath)
        const current = await readTextFile(uri)
        if (current !== null && hashText(current) === target.hash) {
            return false
        }
        const isDirty = vscode.workspace.textDocuments.some(
            (document) => document.uri.fsPath === uri.fsPath && document.isDirty,
        )
        if (isDirty) {
            throw new Error('该章在编辑器中有未保存的修改，请先保存或撤销后再恢复')
        }
        if (current !== null) {
            await writeChapterSnapshot({ dirPath, chapterPath, content: current, reason: 'restore' })
        }
        const content = await readChapterVersion(dirPath, chapterPath, snapshotId)
        await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content))
        this.syncChapterState(this.chapterKey(dirPath, chapterPath), target.hash, new Date().toISOString())
        try {
            await this.indexer?.indexFile(uri)
        } catch (error) {
            logger.warn(`章节恢复后索引重建失败：${uri.fsPath}（${toCauseMessage(error)}）`)
        }
        logger.info(`章节快照已恢复：${chapterPath}/${snapshotId}`)
        return true
    }

    /** 删除章节某一版：只影响该版本 */
    public async removeChapterVersion(
        dirPath: string,
        chapterPath: string,
        snapshotId: string,
    ): Promise<boolean> {
        return deleteChapterVersion(dirPath, chapterPath, snapshotId)
    }

    /**
     * AI 写回前强制留底：不受间隔限制，只对 Chapters 下的文档生效。
     * 关键约束：内容由调用方从编辑器取写回前的全文，与撤销栈对齐；异常必须吞掉，不能阻断写回本身。
     */
    public async captureChapterBeforeWrite(uri: vscode.Uri, content: string): Promise<void> {
        const scope = this.resolveSavedScope(uri)
        if (scope === null || scope.kind !== 'chapter') {
            return
        }
        try {
            await this.recordChapter(scope.dirPath, scope.chapterPath, content, 'ai-write')
        } catch (error) {
            logger.warn(`AI 写回前的章节留底失败：${uri.fsPath}（${toCauseMessage(error)}）`)
        }
    }

    /** 章节文件的绝对 Uri：路径逐段校验后拼接，不接受前端原样字符串 */
    private chapterUri(chapterPath: string): vscode.Uri {
        return buildStorageUri(resolveStorageRoot(), toSafeSegments(chapterPath, '章节'))
    }

    /** 章节节流状态的键：作品目录与章节路径的组合，避免跨作品串版本 */
    private chapterKey(dirPath: string, chapterPath: string): string {
        return `${dirPath}::${chapterPath}`
    }

    /** 取或建单章节流状态 */
    private chapterStateOf(key: string): ChapterState {
        const existing = this.chapterStates.get(key)
        if (existing !== undefined) {
            return existing
        }
        const created: ChapterState = {
            timer: null,
            latest: null,
            lastCreatedAt: 0,
            lastHash: null,
            loaded: false,
            chain: Promise.resolve(),
        }
        this.chapterStates.set(key, created)
        return created
    }

    /** 用刚写入的一版刷新章节缓存 */
    private syncChapterState(key: string, hash: string, createdAt: string): void {
        const state = this.chapterStateOf(key)
        const timestamp = Date.parse(createdAt)
        state.lastCreatedAt = Number.isFinite(timestamp) ? timestamp : Date.now()
        state.lastHash = hash
        state.loaded = true
    }

    /** 首次访问时载入该章最新一版：没有历史时留空，让第一次变更立即产生基线 */
    private async ensureChapterLoaded(
        dirPath: string,
        chapterPath: string,
        state: ChapterState,
    ): Promise<void> {
        if (state.loaded) {
            return
        }
        state.loaded = true
        try {
            const versions = await listChapterVersions(dirPath, chapterPath)
            const newest = versions[0]
            if (newest !== undefined) {
                this.syncChapterState(this.chapterKey(dirPath, chapterPath), newest.hash, newest.createdAt)
            }
        } catch (error) {
            logger.warn(`章节时间线读取失败，按无历史处理：${chapterPath}（${toCauseMessage(error)}）`)
        }
    }

    /**
     * 章节统一记录入口：判重 → 强制来源立即写 → 其余按间隔排队。
     * 关键约束：排队时定时器只在首次设置，后续变更不续期（throttle 语义）；AI 写回不吃节流。
     */
    private async recordChapter(
        dirPath: string,
        chapterPath: string,
        content: string,
        reason: ChapterSnapshotReason,
        label?: string,
    ): Promise<void> {
        const isForced = reason === 'ai-write'
        if (!getZhaiConfig().pressSnapshotEnabled && !isForced) {
            return
        }
        const key = this.chapterKey(dirPath, chapterPath)
        const state = this.chapterStateOf(key)
        await this.enqueue(state, async () => {
            await this.ensureChapterLoaded(dirPath, chapterPath, state)
            const hash = hashText(content)
            if (state.lastHash === hash) {
                return
            }
            state.latest = { content, reason, label: normalizeLabel(label) }
            if (isForced) {
                await this.flushChapter(dirPath, chapterPath, state)
                return
            }
            const intervalMs = getZhaiConfig().pressSnapshotChapterIntervalSeconds * 1000
            const wait = intervalMs - (Date.now() - state.lastCreatedAt)
            if (wait <= 0) {
                await this.flushChapter(dirPath, chapterPath, state)
                return
            }
            if (state.timer === null) {
                state.timer = setTimeout(() => {
                    state.timer = null
                    void this.enqueue(state, async () => {
                        await this.flushChapter(dirPath, chapterPath, state)
                    })
                }, wait)
                state.timer.unref()
            }
        })
    }

    /** 把章节待写内容落成一版：内容与最新一版相同时静默跳过 */
    private async flushChapter(dirPath: string, chapterPath: string, state: ChapterState): Promise<void> {
        const pending = state.latest
        if (pending === null) {
            return
        }
        state.latest = null
        const hash = hashText(pending.content)
        if (state.lastHash === hash) {
            return
        }
        try {
            const version = await writeChapterSnapshot({
                dirPath,
                chapterPath,
                content: pending.content,
                reason: pending.reason,
                label: pending.label,
            })
            this.syncChapterState(this.chapterKey(dirPath, chapterPath), version.hash, version.createdAt)
            await pruneChapterVersions(dirPath, chapterPath)
        } catch (error) {
            logger.warn(`章节快照写入失败：${chapterPath}（${toCauseMessage(error)}）`)
        }
    }

    /** 卸载：清掉未到期的定时器，并把待写内容立即落盘，避免关窗丢最后一版 */
    public dispose(): void {
        for (const [dirPath, state] of this.states) {
            if (state.timer !== null) {
                clearTimeout(state.timer)
                state.timer = null
            }
            if (state.latest !== null) {
                const latest = state.latest
                state.latest = null
                void writeSnapshot({
                    dirPath,
                    files: latest.files,
                    reason: 'auto',
                    trigger: [...latest.trigger],
                }).catch((error: unknown) => {
                    logger.warn(`退出前的快照落盘失败：${dirPath}（${toCauseMessage(error)}）`)
                })
            }
        }
        this.states.clear()
        for (const [key, state] of this.chapterStates) {
            if (state.timer !== null) {
                clearTimeout(state.timer)
                state.timer = null
            }
            const pending = state.latest
            if (pending === null) {
                continue
            }
            state.latest = null
            const separator = key.indexOf('::')
            const dirPath = key.slice(0, separator)
            const chapterPath = key.slice(separator + 2)
            void writeChapterSnapshot({
                dirPath,
                chapterPath,
                content: pending.content,
                reason: pending.reason,
                label: pending.label,
            }).catch((error: unknown) => {
                logger.warn(`退出前的章节快照落盘失败：${chapterPath}（${toCauseMessage(error)}）`)
            })
        }
        this.chapterStates.clear()
    }

    /** 取或建某作品的节流状态：首次访问时把最新一版的时间与哈希载入内存 */
    private stateOf(dirPath: string): ProjectSnapshotState {
        const existing = this.states.get(dirPath)
        if (existing !== undefined) {
            return existing
        }
        const created: ProjectSnapshotState = {
            timer: null,
            latest: null,
            lastCreatedAt: 0,
            lastHashes: null,
            loaded: false,
            chain: Promise.resolve(),
        }
        this.states.set(dirPath, created)
        return created
    }

    /** 用刚写入的一版刷新缓存：后续去重与节流以它为准 */
    private syncState(dirPath: string, snapshot: StoredSnapshot): void {
        const state = this.stateOf(dirPath)
        const timestamp = Date.parse(snapshot.createdAt)
        state.lastCreatedAt = Number.isFinite(timestamp) ? timestamp : Date.now()
        state.lastHashes = snapshot.hashes
        state.loaded = true
    }

    /** 首次访问时载入最新一版：没有历史版本时留空，让第一次变更立即产生基线 */
    private async ensureLoaded(dirPath: string, state: ProjectSnapshotState): Promise<void> {
        if (state.loaded) {
            return
        }
        state.loaded = true
        try {
            const snapshots = await listStoredSnapshots(dirPath)
            const newest = snapshots[0]
            if (newest !== undefined) {
                this.syncState(dirPath, newest)
            }
        } catch (error) {
            logger.warn(`快照时间线读取失败，按无历史处理：${dirPath}（${toCauseMessage(error)}）`)
        }
    }

    /**
     * 统一记录入口：合并触发范围 → 判重 → 按间隔决定立即写还是排队。
     * 关键约束：排队时定时器只在首次设置，后续变更不续期（throttle 语义）。
     */
    private async record(
        dirPath: string,
        files: PressWorkspaceFiles,
        trigger: readonly PressSnapshotTrigger[],
    ): Promise<void> {
        if (!getZhaiConfig().pressSnapshotEnabled) {
            return
        }
        const state = this.stateOf(dirPath)
        await this.enqueue(state, async () => {
            await this.ensureLoaded(dirPath, state)
            const merged = new Set<PressSnapshotTrigger>(state.latest?.trigger ?? [])
            for (const item of trigger) {
                merged.add(item)
            }
            const hashes = hashWorkspaceFiles(files)
            if (state.lastHashes !== null && isSameHashes(hashes, state.lastHashes)) {
                return
            }
            state.latest = { files, trigger: merged }
            const intervalMs = getZhaiConfig().pressSnapshotIntervalSeconds * 1000
            const wait = intervalMs - (Date.now() - state.lastCreatedAt)
            if (wait <= 0) {
                await this.flushPending(dirPath, state)
                return
            }
            if (state.timer === null) {
                state.timer = setTimeout(() => {
                    state.timer = null
                    void this.enqueue(state, async () => {
                        await this.flushPending(dirPath, state)
                    })
                }, wait)
                state.timer.unref()
            }
        })
    }

    /** 把待写内容落成一版：内容和最新一版相同时静默跳过 */
    private async flushPending(dirPath: string, state: ProjectSnapshotState): Promise<void> {
        const pending = state.latest
        if (pending === null) {
            return
        }
        state.latest = null
        const hashes = hashWorkspaceFiles(pending.files)
        if (state.lastHashes !== null && isSameHashes(hashes, state.lastHashes)) {
            return
        }
        try {
            const snapshot = await writeSnapshot({
                dirPath,
                files: pending.files,
                reason: 'auto',
                trigger: [...pending.trigger],
            })
            this.syncState(dirPath, snapshot)
            await this.prune(dirPath)
        } catch (error) {
            logger.warn(`自动快照写入失败：${dirPath}（${toCauseMessage(error)}）`)
        }
    }

    /** 串行执行：同一作品的多次记录按到达顺序写盘，避免并发建目录 */
    private enqueue(state: { chain: Promise<void> }, task: () => Promise<void>): Promise<void> {
        state.chain = state.chain.then(task).catch((error: unknown) => {
            logger.warn(`快照任务执行失败：${toCauseMessage(error)}`)
        })
        return state.chain
    }

    /**
     * 清理过期自动快照：近 KEEP_RECENT 版全留，更早的只保留每日首版且不超过 KEEP_DAILY_DAYS 天。
     * 关键约束：手动快照与恢复前留底不参与自动清理，用户主动留的版本必须一直在。
     */
    private async prune(dirPath: string): Promise<void> {
        const snapshots = await listStoredSnapshots(dirPath)
        const auto = snapshots.filter((item) => item.reason === 'auto')
        const keptDays = new Set<string>()
        const deadline = Date.now() - KEEP_DAILY_DAYS * 24 * 60 * 60 * 1000
        for (const [index, snapshot] of auto.entries()) {
            if (index < KEEP_RECENT) {
                continue
            }
            const day = snapshot.createdAt.slice(0, 10)
            const timestamp = Date.parse(snapshot.createdAt)
            const isRecent = Number.isFinite(timestamp) && timestamp >= deadline
            if (isRecent && !keptDays.has(day)) {
                keptDays.add(day)
                continue
            }
            try {
                await deleteSnapshotDir(dirPath, snapshot.id)
            } catch (error) {
                logger.warn(`过期快照清理失败：${dirPath}/${snapshot.id}（${toCauseMessage(error)}）`)
            }
        }
    }

    /**
     * 把一次保存的文件 Uri 换算成快照目标：结构化文档给出触发范围，Chapters 下的正文给出章节路径。
     * 关键约束：只认存储根内的 press/ 目录，其它路径一律返回 null，避免把任意保存事件卷进快照。
     */
    private resolveSavedScope(uri: vscode.Uri): SavedScope | null {
        const rootPath = resolveStorageRoot().path
        if (!uri.path.toLowerCase().startsWith(`${rootPath.toLowerCase()}/`)) {
            return null
        }
        const relative = uri.path.slice(rootPath.length + 1)
        const segments = relative.split('/')
        if ((segments[0] ?? '').toLowerCase() !== PRESS_MODULE_DIR) {
            return null
        }
        const projectName = segments[1] ?? ''
        if (projectName.length === 0) {
            return null
        }
        const dirPath = `${PRESS_MODULE_DIR}/${projectName}`
        // 章节正文：press/{作品}/Chapters/... ，无卷目录时四段（含文件名）、有卷目录时五段
        if ((segments[2] ?? '') === PROJECT_CHAPTER_DIR) {
            if (segments.length < 4) {
                return null
            }
            return { kind: 'chapter', dirPath, chapterPath: relative }
        }
        if (segments.length !== 3) {
            return null
        }
        const key = FILE_NAME_TO_KEY.get((segments[2] ?? '').toLowerCase())
        if (key === undefined) {
            return null
        }
        const trigger: PressSnapshotTrigger = key === 'readme' || key === 'setting' ? 'setting' : key
        return { kind: 'workspace', dirPath, trigger }
    }
}
