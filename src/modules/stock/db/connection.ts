/**
 * 在线图库索引库连接：按存储根打开 {root}/sqlite/stock.db，并提供降级与损坏重建。
 * 复用约定：与 media.db 同一套 PRAGMA——DELETE 日志模式保证单文件，避免云盘把 -wal / -shm 拆成冲突副本；
 * synchronous 取 FULL，写入低频，元数据可靠优先于吞吐。
 * 关键约束：连接按存储根缓存，切换存储根时必须关闭旧连接；打开失败降级到扩展缓存目录并由界面提示；
 * quick_check 不通过时把库文件改名留档后重建——图片本体在 unsplash/ 下，重建只丢署名与来源。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import Database from 'better-sqlite3'
import { logger } from '@modules/common/logger'
import { ensureStockSchema } from './schema'
import type * as vscode from 'vscode'
import { STOCK_DB_FILE, STOCK_INDEX_DIR } from '../constants'

/** PRAGMA：单文件日志模式 + 可靠写入，适配云盘与网络盘 */
const PRAGMAS = [
    'PRAGMA journal_mode = DELETE;',
    'PRAGMA synchronous = FULL;',
    'PRAGMA temp_store = MEMORY;',
    'PRAGMA cache_size = -16000;',
    'PRAGMA foreign_keys = ON;',
] as const

/** 打开结果：路径与降级标记由调用方转成界面提示 */
export interface StockDatabase {
    db: Database.Database
    /** 索引库实际绝对路径 */
    filePath: string
    /** true 表示已降级到扩展缓存目录 */
    degraded: boolean
    /** 上一次打开时重建过损坏库 */
    isRecovered: boolean
}

/** 按存储根缓存的连接：切换存储根时由 closeStockDatabases 关闭 */
const connections = new Map<string, StockDatabase>()

/** 打开指定路径的库文件：目录不存在先创建，损坏则改名留档后重建 */
function openAt(filePath: string): { db: Database.Database; isRecovered: boolean } {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const db = new Database(filePath)
    for (const pragma of PRAGMAS) {
        db.exec(pragma)
    }
    try {
        const check = db.pragma('quick_check', { simple: true })
        if (check !== 'ok') {
            throw new Error(`quick_check 未通过：${String(check)}`)
        }
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        logger.error(`在线图库索引库损坏，准备重建：${filePath}（${reason}）`)
        db.close()
        const archive = `${filePath}.corrupt-${String(Date.now())}`
        fs.renameSync(filePath, archive)
        const fresh = new Database(filePath)
        for (const pragma of PRAGMAS) {
            fresh.exec(pragma)
        }
        ensureStockSchema(fresh)
        return { db: fresh, isRecovered: true }
    }
    ensureStockSchema(db)
    return { db, isRecovered: false }
}

/**
 * 打开当前存储根对应的在线图库索引库。
 * @param root 存储根 Uri
 * @param cacheRoot 扩展缓存目录：存储根不可写时作为降级位置
 */
export function openStockDatabase(root: vscode.Uri, cacheRoot: vscode.Uri): StockDatabase {
    const key = root.fsPath
    const cached = connections.get(key)
    if (cached !== undefined) {
        return cached
    }
    const primaryPath = path.join(root.fsPath, STOCK_INDEX_DIR, STOCK_DB_FILE)
    let opened: StockDatabase
    try {
        const { db, isRecovered } = openAt(primaryPath)
        opened = { db, filePath: primaryPath, degraded: false, isRecovered }
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        logger.warn(`在线图库索引库打开失败，降级到缓存目录：${primaryPath}（${reason}）`)
        const fallbackPath = path.join(cacheRoot.fsPath, STOCK_DB_FILE)
        const { db, isRecovered } = openAt(fallbackPath)
        opened = { db, filePath: fallbackPath, degraded: true, isRecovered }
    }
    connections.set(key, opened)
    return opened
}

/** 关闭全部连接：存储根变更后调用，下次取值时按新根重建 */
export function closeStockDatabases(): void {
    for (const [key, entry] of connections) {
        try {
            entry.db.close()
        } catch (error) {
            logger.error(`在线图库索引库关闭失败：${key}`, error)
        }
    }
    connections.clear()
}
