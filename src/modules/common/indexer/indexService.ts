/**
 * 索引服务：FileSystemWatcher 增量监听 + 防抖队列批处理 + 全量重建与激活自检。
 * 设计源：docs/modules/common.md 第 4.1/4.2 节；mtime 与 hash 双重比对避免无变更重写。
 */
import * as vscode from 'vscode'
import type Database from 'better-sqlite3'
import { getZhaiConfig, resolveStorageRoot } from '../config'
import { parseFileMeta } from '../db/fileMeta'
import { countFileRows, deleteFileRow, listIndexedPaths, upsertFileRows } from '../db/indexRepository'
import type { FileRow } from '../db/indexRepository'
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
                { location: vscode.ProgressLocation.Window, title: 'Zhai：重建索引' },
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
            const builtAt = this.db.prepare('SELECT value FROM meta WHERE key = ?').get('built_at') as { value: string } | undefined
            this.lastBuiltAt = builtAt?.value ?? null
            return
        }
        logger.warn(`索引不一致：文件 ${files.length} / 记录 ${indexed}，触发重建`)
        if (cfg.rebuildOnActivate) {
            await this.fullRebuild()
        }
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
        this.pendingUris.add(uri.toString())
        this.scheduleFlush()
    }

    private enqueueDelete(uri: vscode.Uri): void {
        deleteFileRow(this.db, this.toRelativePath(uri))
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

    private toRelativePath(uri: vscode.Uri): string {
        const root = resolveStorageRoot()
        return uri.path.startsWith(`${root.path}/`) ? uri.path.slice(root.path.length + 1) : uri.path
    }

    private baseName(uri: vscode.Uri): string {
        return uri.path.split('/').pop() ?? uri.path
    }

    private buildExcludeGlob(): vscode.GlobPattern {
        return `{${getZhaiConfig().indexExclude.join(',')}}`
    }
}
