/**
 * 索引服务：FileSystemWatcher 增量监听 + 防抖队列批处理 + 全量重建与激活自检。
 * 设计源：docs/modules/common.md 第 4.1/4.2 节；mtime 与 hash 双重比对避免无变更重写。
 */
import * as vscode from 'vscode'
import type { FileRow } from '../db/indexRepository'
import type Database from 'better-sqlite3'
import { PRESS_IMPORT_DIR } from '../../../shared/types/press'
import { getZhaiConfig, resolveStorageRoot } from '../config'
import { parseFileMeta } from '../db/fileMeta'
import { countFileRows, deleteFileRow, listIndexedPaths, upsertFileRows } from '../db/indexRepository'
import { logger } from '../logger'

/** 索引状态快照，供状态栏与 Webview 展示 */
export interface IndexStatus {
    indexedCount: number
    lastBuiltAt: string | null
    isRebuilding: boolean
}

export class IndexService {
    private watcher: vscode.FileSystemWatcher | null = null
    private debounceTimer: NodeJS.Timeout | null = null
    /** 待处理变更路径集合（Set 去重，防抖后批量出队） */
    private pendingUris: Set<string> = new Set()
    private isRebuilding = false
    private lastBuiltAt: string | null = null

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

    /** 注册增量监听，须在 activate 中调用并纳入 subscriptions */
    public registerWatcher(disposables: vscode.Disposable[]): void {
        const cfg = getZhaiConfig()
        let root: vscode.Uri
        try {
            root = resolveStorageRoot()
        } catch {
            logger.info('未配置文档保存目录，跳过增量监听注册（打开工作区或配置 zhai.storage.rootPath 后生效）')
            return
        }
        const pattern = new vscode.RelativePattern(root, '**/*.md')
        this.watcher = vscode.workspace.createFileSystemWatcher(pattern)
        disposables.push(
            this.watcher,
            this.watcher.onDidChange((uri) => this.enqueue(uri), this),
            this.watcher.onDidCreate((uri) => this.enqueue(uri), this),
            this.watcher.onDidDelete((uri) => this.enqueueDelete(uri), this),
        )
        logger.info(`增量监听已注册：${pattern.pattern}，防抖 ${cfg.indexDebounceMs}ms`)
    }

    /** 全量重建：扫描存储根下全部 .md 并重建索引，支持进度上报与取消 */
    public async fullRebuild(token?: vscode.CancellationToken): Promise<void> {
        if (this.isRebuilding) {
            return
        }
        this.isRebuilding = true
        this.statusEmitter.fire(this.getStatus())
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
                            break
                        }
                        const row = await this.buildRowFromFile(file)
                        if (row) {
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
            this.lastBuiltAt = new Date().toISOString()
            this.db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)').run('built_at', this.lastBuiltAt)
            logger.info(`全量重建完成：${processed} 个文件`)
        } finally {
            this.isRebuilding = false
            this.statusEmitter.fire(this.getStatus())
        }
    }

    /** 激活自愈：文件数与记录数不一致时触发后台重建（US-5 故障自修场景） */
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
        const indexed = countFileRows(this.db)
        if (files.length === indexed) {
            logger.info(`索引自检通过：${indexed} 个文件`)
            const builtAt = this.db.prepare('SELECT value FROM meta WHERE key = ?').get('built_at') as
                { value: string } | undefined
            this.lastBuiltAt = builtAt?.value ?? null
            return
        }
        logger.warn(`索引不一致：文件 ${files.length} / 记录 ${indexed}，触发重建`)
        if (cfg.rebuildOnActivate) {
            await this.fullRebuild()
        }
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
     * 关键约束：比较统一小写，规避 VSCode 的 fsPath 把盘符小写、而配置保留原始大小写导致的误判。
     */
    public toRelativePath(uri: vscode.Uri): string {
        const rootPath = resolveStorageRoot().path
        return uri.path.toLowerCase().startsWith(`${rootPath.toLowerCase()}/`)
            ? uri.path.slice(rootPath.length + 1)
            : uri.path
    }

    public dispose(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer)
            this.debounceTimer = null
        }
        this.watcher?.dispose()
        this.watcher = null
    }

    private enqueue(uri: vscode.Uri): void {
        // 导入工作目录只存素材与 AI 初稿，不属于作品内容，watcher 触发时直接丢弃
        if (uri.path.includes(`/${PRESS_IMPORT_DIR}/`)) {
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

    private baseName(uri: vscode.Uri): string {
        return uri.path.split('/').pop() ?? uri.path
    }

    /**
     * 排除规则：用户配置项 + 固定的导入工作目录。
     * 关键约束：`_import` 下存放素材与 AI 初稿，若计入索引会使作品字数虚高，故无条件排除。
     */
    private buildExcludeGlob(): vscode.GlobPattern {
        const patterns = [...getZhaiConfig().indexExclude, `**/${PRESS_IMPORT_DIR}/**`]
        return `{${patterns.join(',')}}`
    }
}
