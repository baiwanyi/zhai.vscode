/**
 * 索引服务：FileSystemWatcher 增量监听 + 防抖队列批处理 + 全量重建与激活自检。
 * 设计源：docs/modules/common.md 第 4.1/4.2 节；mtime 与 hash 双重比对避免无变更重写。
 * 复用约定：素材目录名与作品快照目录名取自 shared/types/press，统一走同一份排除规则。
 * 关键约束：watcher 入队与全量扫描都必须排除素材目录与快照目录，否则 AI 初稿与历史副本会混进作品字数。
 */
import * as vscode from 'vscode'
import { LEGACY_PRESS_IMPORT_DIR, PRESS_IMPORT_DIR, PRESS_SNAPSHOT_DIR } from '@shared/types/press'
import type { FileRow } from '../db/indexRepository'
import type Database from 'better-sqlite3'
import { getZhaiConfig, PROMPT_DIR, resolveStorageRoot } from '../config'
import { parseFileMeta } from '../db/fileMeta'
import { countFileRows, deleteFileRow, listIndexedPaths, upsertFileRows } from '../db/indexRepository'
import { logger } from '../logger'

/** 素材目录的两种写法：新名与旧版 `_import`，旧目录在迁移完成前仍可能存在于磁盘上 */
const MATERIAL_DIR_NAMES: readonly string[] = [PRESS_IMPORT_DIR, LEGACY_PRESS_IMPORT_DIR]

/**
 * 不参与索引的目录：素材、作品快照与词库。
 * 关键约束：素材目录存素材与 AI 初稿、快照目录存四份文档的历史副本，计入索引会让作品字数与列表虚高；
 * 词库（tags / rules）是插件自己维护的配置数据，正文不参与检索，计入只会污染字数与文件数；
 * 公众号批次稿（wechat/{appid}/post/…）与笔记同构，需要进入索引：AI 对话提及、校对与活跃文档判定都靠它；
 * 字数统计只认 notes/ 与 press/ 前缀（statsRepository 的 COUNTED_PREFIXES），不会被批次稿污染；
 * 三者在增量监听、全量重建与激活自检三条路径上口径必须一致。
 */
const EXCLUDED_DIR_NAMES: readonly string[] = [...MATERIAL_DIR_NAMES, PRESS_SNAPSHOT_DIR, PROMPT_DIR]

/**
 * 从排除 glob 中提取纯目录段：`**\/node_modules\/**` → `node_modules`。
 * 关键约束：`createFileSystemWatcher` 没有 exclude 参数，watcher 只能按路径段自行判断，
 * 因此这里只认「整段目录」形态；带文件名或其它通配的复杂模式原样跳过，由激活自检兜底清理。
 */
function toExcludedDirNames(globs: readonly string[]): string[] {
    const names: string[] = []
    for (const glob of globs) {
        const matched = /^\*\*\/([^*/]+)\/\*\*$/.exec(glob)
        const name = matched?.[1]
        if (name !== undefined) {
            names.push(name)
        }
    }
    return names
}

/** 路径归一：统一正斜杠并去掉尾部斜杠，使 fsPath 与配置路径可在同一形态下比对 */
function toSlashedPath(value: string): string {
    return value.replace(/\\/gu, '/').replace(/\/+$/u, '')
}

/** 索引状态快照，供状态栏与 Webview 展示 */
export interface IndexStatus {
    indexedCount: number
    lastBuiltAt: string | null
    isRebuilding: boolean
}

export class IndexService {
    /** 当前监听的登记项：重新注册前要先释放，否则旧存储根的 watcher 会继续把事件送进索引 */
    private watcherDisposables: vscode.Disposable[] = []
    private debounceTimer: NodeJS.Timeout | null = null
    /** 待处理变更路径集合（Set 去重，防抖后批量出队） */
    private pendingUris: Set<string> = new Set()
    private isRebuilding = false
    private lastBuiltAt: string | null = null
    /** 增量监听要丢弃的目录名：全量扫描的排除规则里能折成目录段的那部分 */
    private excludedDirNames: readonly string[] = EXCLUDED_DIR_NAMES

    public constructor(
        private readonly db: Database.Database,
        private readonly statusEmitter: vscode.EventEmitter<IndexStatus>,
    ) {}

    public getStatus(): IndexStatus {
        return {
            indexedCount: countFileRows(this.db),
            lastBuiltAt: this.lastBuiltAt,
            isRebuilding: this.isRebuilding,
        }
    }

    /** 注册增量监听，须在 activate 中调用并纳入 subscriptions；存储根变更后可重复调用，旧监听先释放 */
    public registerWatcher(disposables: vscode.Disposable[]): void {
        this.disposeWatcher()
        const cfg = getZhaiConfig()
        let root: vscode.Uri
        try {
            root = resolveStorageRoot()
        } catch {
            logger.info('未配置文档保存目录，跳过增量监听注册（打开工作区或配置 zhai.storage.rootPath 后生效）')
            return
        }
        const pattern = new vscode.RelativePattern(root, '**/*.md')
        // watcher 没有 exclude 参数，只能自行按目录段丢弃：与全量扫描的排除规则同源，
        // 否则 node_modules / .git 下的 Markdown 会被增量索引而重建扫不到，数量永远对不上
        this.excludedDirNames = [...EXCLUDED_DIR_NAMES, ...toExcludedDirNames(cfg.indexExclude)]
        const fileWatcher = vscode.workspace.createFileSystemWatcher(pattern)
        this.watcherDisposables = [
            fileWatcher,
            fileWatcher.onDidChange((uri) => this.enqueue(uri), this),
            fileWatcher.onDidCreate((uri) => this.enqueue(uri), this),
            fileWatcher.onDidDelete((uri) => this.enqueueDelete(uri), this),
        ]
        disposables.push(...this.watcherDisposables)
        logger.info(`增量监听已注册：${pattern.pattern}，防抖 ${cfg.indexDebounceMs}ms`)
    }

    /** 全量重建：扫描存储根下全部 .md 并重建索引，支持进度上报与取消 */
    public async fullRebuild(token?: vscode.CancellationToken): Promise<void> {
        if (this.isRebuilding) {
            return
        }
        this.isRebuilding = true
        this.statusEmitter.fire(this.getStatus())
        /** 本次扫描命中的相对路径：重建结束后据此清理失效记录 */
        const seen = new Set<string>()
        let isAborted = false
        try {
            const root = resolveStorageRoot()
            const files = await vscode.workspace.findFiles(
                new vscode.RelativePattern(root, '**/*.md'),
                this.buildExcludeGlob(),
            )
            const rows: FileRow[] = []
            let processed = 0
            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Window, title: '宅写作：重建索引' },
                async (progress) => {
                    for (const file of files) {
                        if (token?.isCancellationRequested) {
                            isAborted = true
                            break
                        }
                        // 单个文件读不到（被占用、权限不足）不该让整次重建失败；
                        // 但它仍在磁盘上，登记进 seen 以免旧记录被当成孤儿清掉
                        const row = await this.buildRowFromFile(file).catch((error: unknown) => {
                            seen.add(this.toRelativePath(file))
                            logger.debug(`重建跳过不可读文件：${file.path}（${String(error)}）`)
                            return null
                        })
                        if (row) {
                            seen.add(row.path)
                            rows.push(row)
                        }
                        processed += 1
                        if (rows.length >= 200) {
                            upsertFileRows(this.db, rows)
                            rows.length = 0
                            // 分片让出事件循环，避免大仓库索引期间 UI 冻结（AC-9）
                            await new Promise<void>((resolve) => setTimeout(resolve, 0))
                            progress.report({ increment: (processed / Math.max(files.length, 1)) * 100 })
                        }
                    }
                    if (rows.length > 0) {
                        upsertFileRows(this.db, rows)
                    }
                    progress.report({ increment: 100 })
                },
            )
            // 取消时结果不完整，不能据此删记录，否则会清掉尚未扫描到的文件
            if (!isAborted) {
                this.pruneMissing(seen)
            }
            this.lastBuiltAt = new Date().toISOString()
            this.db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)').run('built_at', this.lastBuiltAt)
            logger.info(`全量重建完成：${processed} 个文件`)
        } finally {
            this.isRebuilding = false
            this.statusEmitter.fire(this.getStatus())
        }
    }

    /**
     * 清理扫描结果之外的索引记录：全量重建只做 upsert，文件在扩展未运行期间被删、
     * 或落进排除规则后旧记录会一直留着，自检因此每次都判定数量不一致并反复触发重建。
     * 关键约束：只能在扫描完整结束时调用，取消或异常时必须跳过，否则会清掉尚未扫描到的文件。
     */
    private pruneMissing(seen: ReadonlySet<string>): void {
        const stale = [...listIndexedPaths(this.db).keys()].filter((path) => !seen.has(path))
        if (stale.length === 0) {
            return
        }
        for (const path of stale) {
            deleteFileRow(this.db, path)
        }
        logger.info(`已清理失效索引记录 ${String(stale.length)} 条`)
    }

    /**
     * 激活自愈（US-5 故障自修场景）：按「缺」与「多」分别处置 ——
     * 磁盘有而记录没有（索引落后）才全量重建；记录多出来的（文件已被删、或曾误索引排除目录）
     * 只做定点清理，避免每次激活都因几十条残留记录白跑一遍全量扫描。
     */
    public async selfCheck(): Promise<void> {
        const cfg = getZhaiConfig()
        let root: vscode.Uri
        try {
            root = resolveStorageRoot()
        } catch {
            logger.info('未配置文档保存目录，跳过激活自检')
            return
        }
        const files = await vscode.workspace.findFiles(
            new vscode.RelativePattern(root, '**/*.md'),
            this.buildExcludeGlob(),
        )
        const seen = new Set(files.map((uri) => this.toRelativePath(uri)))
        const indexed = listIndexedPaths(this.db)
        // 缺记录才是真故障（索引落后于磁盘），数量对不上就走全量重建
        const missingCount = [...seen].filter((path) => !indexed.has(path)).length
        if (missingCount > 0) {
            logger.warn(`索引不一致：文件 ${seen.size} / 记录 ${indexed.size}，缺 ${missingCount} 条，触发重建`)
            if (cfg.rebuildOnActivate) {
                await this.fullRebuild()
            }
            return
        }
        // 多出的记录来自「增量监听曾索引到排除目录」或「扩展未运行期间被删的文件」，
        // 只清这些记录即可：按数量差直接重建会让每次激活都白跑一遍全量扫描
        this.pruneMissing(seen)
        logger.info(`索引自检通过：${seen.size} 个文件`)
        const builtAt = this.db.prepare('SELECT value FROM meta WHERE key = ?').get('built_at') as
            { value: string } | undefined
        this.lastBuiltAt = builtAt?.value ?? null
    }

    /** 立即索引单个文件并广播状态：供主动写入（如新建笔记）后即时收敛列表，跳过防抖队列 */
    public async indexFile(uri: vscode.Uri): Promise<void> {
        const row = await this.buildRowFromFile(uri)
        if (!row) {
            return
        }
        upsertFileRows(this.db, [row])
        this.statusEmitter.fire(this.getStatus())
    }

    /**
     * 删除指定相对前缀下的全部索引记录：卷/作品被重命名或删除后由宿主主动收敛，避免列表残留条目。
     * 关键约束：递归删除目录时 watcher 不保证逐文件回调，故不能依赖删除事件；有变更才广播状态。
     */
    public removeFilesUnder(relativePrefix: string): void {
        const stalePaths = [...listIndexedPaths(this.db).keys()].filter((path) => path.startsWith(relativePrefix))
        for (const path of stalePaths) {
            deleteFileRow(this.db, path)
        }
        if (stalePaths.length > 0) {
            logger.debug(`已清理索引记录 ${stalePaths.length} 条：${relativePrefix}`)
            this.statusEmitter.fire(this.getStatus())
        }
    }

    /**
     * 删除单份文档的索引记录：单章删除或跨卷移动后由宿主主动收敛，避免详情页残留旧路径。
     * 关键约束：按完整相对路径精确匹配，不做前缀匹配，避免误伤同名前缀的其他文档；无该记录时不广播。
     */
    public removeFile(relativePath: string): void {
        if (!listIndexedPaths(this.db).has(relativePath)) {
            return
        }
        deleteFileRow(this.db, relativePath)
        logger.debug(`已清理索引记录：${relativePath}`)
        this.statusEmitter.fire(this.getStatus())
    }

    /**
     * 归一化为存储根口径的相对路径：位于存储根内则剥离前缀，否则原样返回绝对路径。
     * 索引写入与宿主侧路径比对（如按活跃编辑器回填列表选中态）共用本方法，避免各处各写一份比较逻辑。
     * 以 fsPath 为基准而不是 Uri.path：后者是百分号编码形态，中文文件名会被编码成 `%XX` 串，
     * 既与磁盘名对不上，也无法再作为打开时的路径片段使用。
     * 关键约束：比较统一小写，规避 VSCode 的 fsPath 把盘符小写、而配置保留原始大小写导致的误判。
     */
    public toRelativePath(uri: vscode.Uri): string {
        const rootPath = toSlashedPath(resolveStorageRoot().fsPath)
        const targetPath = toSlashedPath(uri.fsPath)
        return targetPath.toLowerCase().startsWith(`${rootPath.toLowerCase()}/`)
            ? targetPath.slice(rootPath.length + 1)
            : targetPath
    }

    public dispose(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer)
            this.debounceTimer = null
        }
        this.disposeWatcher()
    }

    /** 释放当前增量监听：重复注册前必须先释放，否则旧存储根的 watcher 会继续把事件送进索引 */
    private disposeWatcher(): void {
        for (const disposable of this.watcherDisposables) {
            disposable.dispose()
        }
        this.watcherDisposables = []
    }

    private enqueue(uri: vscode.Uri): void {
        // 素材与快照目录不属于作品正文，用户排除目录（node_modules / .git 等）也不该进索引，
        // 两者都在此处丢弃：watcher 拿不到 findFiles 的 exclude，口径必须自己对齐
        if (this.excludedDirNames.some((name) => uri.path.includes(`/${name}/`))) {
            return
        }
        this.pendingUris.add(uri.toString())
        this.scheduleFlush()
    }

    private enqueueDelete(uri: vscode.Uri): void {
        deleteFileRow(this.db, this.toRelativePath(uri))
        // 删除不经防抖队列，须立即广播，否则面板列表会残留已删条目
        this.statusEmitter.fire(this.getStatus())
    }

    private scheduleFlush(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer)
        }
        const { indexDebounceMs } = getZhaiConfig()
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null
            void this.flush()
        }, indexDebounceMs)
    }

    private async flush(): Promise<void> {
        const uris = [...this.pendingUris].map((s) => vscode.Uri.parse(s))
        this.pendingUris.clear()
        const indexed = listIndexedPaths(this.db)
        const rows: FileRow[] = []
        for (const uri of uris) {
            const relPath = this.toRelativePath(uri)
            try {
                const row = await this.buildRowFromFile(uri)
                // mtime + hash 未变则跳过，减少无意义写入
                const prev = indexed.get(relPath)
                if (row && row.mtime !== prev) {
                    rows.push(row)
                }
            } catch (error) {
                // 文件可能在防抖窗口内被删除，静默跳过
                logger.debug(`索引跳过不可读文件：${relPath}（${String(error)}）`)
            }
        }
        if (rows.length > 0) {
            upsertFileRows(this.db, rows)
        }
        this.statusEmitter.fire(this.getStatus())
    }

    private async buildRowFromFile(uri: vscode.Uri): Promise<FileRow | null> {
        const stat = await vscode.workspace.fs.stat(uri)
        const content = new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(uri))
        const meta = parseFileMeta(content, this.baseName(uri))
        return {
            path: this.toRelativePath(uri),
            title: meta.title,
            wordCount: meta.wordCount,
            tags: meta.tags,
            hash: meta.hash,
            mtime: new Date(stat.mtime).toISOString(),
        }
    }

    /** 文件名兜底标题：取 fsPath 而非 Uri.path，避免中文文件名被编码成 %XX 串显示到列表 */
    private baseName(uri: vscode.Uri): string {
        return uri.fsPath.split(/[\\/]/u).pop() ?? uri.fsPath
    }

    /**
     * 排除规则：用户配置项 + 固定的素材目录与快照目录。
     * 关键约束：素材目录下存放素材与 AI 初稿、快照目录下存放历史副本，若计入索引会使作品字数虚高，故无条件排除；
     * 旧版 `_import` 一并排除——迁移失败或用户手工保留的旧目录同样不能污染字数统计；
     * 增量监听的排除口径由 `excludedDirNames` 对齐本方法中的目录段，两处必须同时改。
     */
    private buildExcludeGlob(): vscode.GlobPattern {
        const excludedGlobs = EXCLUDED_DIR_NAMES.map((name) => `**/${name}/**`)
        const patterns = [...getZhaiConfig().indexExclude, ...excludedGlobs]
        return `{${patterns.join(',')}}`
    }
}
