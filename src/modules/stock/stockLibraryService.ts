/**
 * 在线图库本地库服务：列举「已下载」、删除、磁盘对账，是图库页与插入流程共用的唯一数据入口。
 * 复用约定：索引读写走 ./repository，路径拼接走 common/storagePath，缩略图缓存走 ./cache，
 * 删除复用 common/storagePath 的 deleteResource（优先回收站）。
 * 关键约束：磁盘是唯一事实来源——列举前先做一次节流对账，补录手工放入的图并标记丢失；
 * 前端只传 photoId 与受控年月，路径一律查表得出，不接受任意路径；
 * 手工放入的文件允许主干不满足上游 id 长度，只要不越界即可入库，但插入时不会再回源 API。
 */
import * as vscode from 'vscode'
import { logger } from '@modules/common/logger'
import { buildStorageUri, deleteResource } from '@modules/common/storagePath'
import { isMediaMonth } from '@shared/types/media'
import { STOCK_DIR, isStockFileStem } from '@shared/types/stock'
import type { StockDownloadedResult, StockLocalPhoto, StockRemoveResult } from '@shared/types/stock'
import { resolveThumbUri } from './cache'
import { STOCK_EXTENSIONS } from './constants'
import {
    countStockPhotos,
    deleteStockPhoto,
    findStockPhoto,
    insertStockPhoto,
    listStockMonths,
    listStockPhotos,
    markStockPhotoMissing,
} from './repository'
import { readStockMonth } from './stockNaming'
import type { StockDatabase } from './db/connection'
import type { StoredStockPhoto } from './repository'

/** 列举前的对账节流窗口：短时间内反复切 tab 不重复遍历磁盘 */
const RECONCILE_INTERVAL_MS = 5_000

/** 服务依赖：数据库按当前存储根懒打开，存储根同样用函数以便跟随配置变更 */
export interface StockLibraryDeps {
    openDatabase: () => StockDatabase
    resolveRoot: () => vscode.Uri
}

/** 磁盘扫描到的一张图 */
interface ScannedStockFile {
    photoId: string
    relPath: string
    ext: string
    byteSize: number
    mtime: number
}

/** 入参收窄：非对象一律拒绝 */
function readPayload(payload: unknown, method: string): Record<string, unknown> {
    if (typeof payload !== 'object' || payload === null) {
        throw new Error(`${method} 缺少参数`)
    }
    return payload as Record<string, unknown>
}

/** 读取年月：缺省或非法值按全部处理，不因脏参数阻断页面 */
function readMonth(payload: unknown): string | null {
    if (typeof payload !== 'object' || payload === null) {
        return null
    }
    const value = (payload as { month?: unknown }).month
    return isMediaMonth(value) ? value : null
}

/** 读取文件名主干：比 photoId 宽松，本地已下载的图都能操作 */
function readStem(payload: unknown, method: string): string {
    const value = readPayload(payload, method).id
    if (!isStockFileStem(value)) {
        throw new Error(`${method} 缺少合法的图片标识`)
    }
    return value
}

/** 扩展名是否在白名单内 */
function isStockExtension(ext: string): boolean {
    return STOCK_EXTENSIONS.includes(ext.toLowerCase())
}

/** 行 → 协议条目：url 由宿主签发，仅本次会话有效 */
function toLocalPhoto(
    row: StoredStockPhoto,
    root: vscode.Uri,
    toWebviewUri: (uri: vscode.Uri) => string,
): StockLocalPhoto | null {
    const month = readStockMonth(row.path)
    if (month === null) {
        return null
    }
    return {
        id: row.photoId,
        path: row.path,
        url: toWebviewUri(buildStorageUri(root, row.path.split('/'))),
        ext: row.ext,
        byteSize: row.byteSize,
        month,
        width: row.width,
        height: row.height,
        alt: row.alt,
        photographer: row.photographer,
        downloadedAt: row.downloadedAt,
        scope: row.scope,
        missing: row.missing,
    }
}

export class StockLibraryService {
    /** 上次对账时刻：节流窗口内不重复遍历磁盘 */
    private lastReconcileAt = 0

    public constructor(private readonly deps: StockLibraryDeps) {}

    /** 已下载总数：状态回执与页头共用 */
    public count(): number {
        return countStockPhotos(this.deps.openDatabase().db)
    }

    /**
     * 列举已下载图片：默认全量，month 只用于收窄。
     * @param toWebviewUri 把磁盘 Uri 转成 webview 可访问 URL 的转换器
     */
    public async list(payload: unknown, toWebviewUri: (uri: vscode.Uri) => string): Promise<StockDownloadedResult> {
        await this.reconcileIfStale()
        const { db } = this.deps.openDatabase()
        const root = this.deps.resolveRoot()
        const month = readMonth(payload)
        const items: StockLocalPhoto[] = []
        for (const row of listStockPhotos(db, month)) {
            const item = toLocalPhoto(row, root, toWebviewUri)
            if (item !== null) {
                items.push(item)
            }
        }
        return { items, months: listStockMonths(db), total: countStockPhotos(db) }
    }

    /** 按标识取一条：插入流程判断是否已下载，不触发对账 */
    public find(photoId: string): StoredStockPhoto | null {
        return findStockPhoto(this.deps.openDatabase().db, photoId)
    }

    /**
     * 删除一张：文件进回收站，成功后清表行与缩略图。
     * 关键约束：先删文件再删行——文件删不掉时保留记录，用户还能重试。
     */
    public async remove(payload: unknown): Promise<StockRemoveResult> {
        const photoId = readStem(payload, 'stock/remove')
        const { db } = this.deps.openDatabase()
        const row = findStockPhoto(db, photoId)
        if (row === null) {
            return { removed: false }
        }
        const root = this.deps.resolveRoot()
        try {
            await deleteResource(buildStorageUri(root, row.path.split('/')), false)
        } catch (error) {
            logger.error(`在线图库删除失败：${row.path}`, error)
            return { removed: false }
        }
        deleteStockPhoto(db, photoId)
        try {
            await vscode.workspace.fs.delete(resolveThumbUri(root, photoId), { useTrash: false })
        } catch {
            // 缩略图是缓存，删不掉不影响结果
        }
        logger.info(`在线图库已删除：${row.path}`)
        return { removed: true }
    }

    /** 全量对账：把磁盘上的图片补录进库，并把已消失的文件标为丢失 */
    public async synchronize(): Promise<void> {
        const { db } = this.deps.openDatabase()
        const root = this.deps.resolveRoot()
        const scanned = await this.scanFiles(root)
        const known = new Map(listStockPhotos(db, null).map((row) => [row.photoId, row]))
        const seen = new Set<string>()
        for (const file of scanned) {
            // 同一主干出现在两个月目录时取路径字典序靠前者：扫描已按路径排序
            if (seen.has(file.photoId)) {
                continue
            }
            seen.add(file.photoId)
            const existing = known.get(file.photoId)
            if (existing !== undefined && existing.path === file.relPath && !existing.missing) {
                continue
            }
            insertStockPhoto(db, {
                photoId: file.photoId,
                path: file.relPath,
                ext: file.ext,
                byteSize: file.byteSize,
                width: existing?.width ?? null,
                height: existing?.height ?? null,
                alt: existing?.alt ?? '',
                photographer: existing?.photographer ?? null,
                photographerUrl: existing?.photographerUrl ?? null,
                downloadLocation: existing?.downloadLocation ?? null,
                scope: existing?.scope ?? 'general',
                downloadedAt: existing?.downloadedAt ?? new Date(file.mtime).toISOString(),
            })
        }
        for (const row of known.values()) {
            if (!seen.has(row.photoId) && !row.missing) {
                markStockPhotoMissing(db, row.photoId, true)
            }
        }
        this.lastReconcileAt = Date.now()
    }

    /** 节流对账：打开已下载 tab 时补齐手工放入的图，失败不影响列表读取 */
    private async reconcileIfStale(): Promise<void> {
        if (Date.now() - this.lastReconcileAt < RECONCILE_INTERVAL_MS) {
            return
        }
        try {
            await this.synchronize()
        } catch (error) {
            logger.error('在线图库目录对账失败', error)
        }
    }

    /**
     * 扫描 unsplash/{YYYYMM}/*：跳过点开头的目录与文件，主干不合法或扩展名不在白名单的条目忽略。
     * 关键约束：读取单个目录失败只跳过该目录，不让整次对账失败。
     */
    private async scanFiles(root: vscode.Uri): Promise<ScannedStockFile[]> {
        const baseUri = buildStorageUri(root, [STOCK_DIR])
        let monthEntries: [string, vscode.FileType][]
        try {
            monthEntries = await vscode.workspace.fs.readDirectory(baseUri)
        } catch {
            return []
        }
        const result: ScannedStockFile[] = []
        const monthDirs = monthEntries
            .filter(([name, type]) => type === vscode.FileType.Directory && !name.startsWith('.') && /^\d{6}$/u.test(name))
            .map(([name]) => name)
            .sort((left, right) => right.localeCompare(left))
        for (const monthDir of monthDirs) {
            let files: [string, vscode.FileType][]
            try {
                files = await vscode.workspace.fs.readDirectory(buildStorageUri(root, [STOCK_DIR, monthDir]))
            } catch {
                continue
            }
            for (const [name, type] of files) {
                if (type !== vscode.FileType.File || name.startsWith('.')) {
                    continue
                }
                const ext = name.split('.').pop() ?? ''
                if (!isStockExtension(ext) || !name.includes('.')) {
                    continue
                }
                const stem = name.slice(0, name.length - ext.length - 1)
                if (!isStockFileStem(stem)) {
                    continue
                }
                const uri = buildStorageUri(root, [STOCK_DIR, monthDir, name])
                try {
                    const stat = await vscode.workspace.fs.stat(uri)
                    result.push({
                        photoId: stem,
                        relPath: `${STOCK_DIR}/${monthDir}/${name}`,
                        ext: ext.toLowerCase(),
                        byteSize: stat.size,
                        mtime: stat.mtime,
                    })
                } catch {
                    // 单个文件读不到就跳过，不影响其余条目
                }
            }
        }
        return result
    }
}
