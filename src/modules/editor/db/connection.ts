/**
 * 标注库连接：按存储根打开 {root}/sqlite/annotations.db，与 media.db 同目录同 PRAGMA。
 * 复用约定：连接按存储根缓存，切换存储根由 closeAnnotationDatabases 关闭；
 * 打开失败降级到扩展缓存目录，损坏时留档后新建，并把留档路径回传给界面提示；
 * 打开后顺带把 doc_path 的绝对路径历史记录收敛成存储根相对路径（幂等，失败只记日志）。
 * 关键约束：标注是用户数据、无法从 Markdown 重建，因此损坏时只能留档重建并明确告知，
 * 不得像 media.db 那样静默恢复；DELETE 日志模式保证只有一个库文件，避免云同步拆出 -wal / -shm。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import Database from 'better-sqlite3'
import { logger } from '@modules/common/logger'
import { normalizeStoredDocPath, toStorageRelativePath } from '@modules/common/storagePath'
import { ensureAnnotationSchema } from './schema'
import type * as vscode from 'vscode'

/** 库文件所在目录：与媒体索引同处存储根的 sqlite/ 下 */
const ANNOTATION_INDEX_DIR = 'sqlite'

/** 库文件名：改名等于用户标注丢失，勿动 */
const ANNOTATION_DB_FILE = 'annotations.db'

/** PRAGMA：单文件日志模式 + 可靠写入，适配云盘与网络盘 */
const PRAGMAS = [
    'PRAGMA journal_mode = DELETE;',
    'PRAGMA synchronous = FULL;',
    'PRAGMA temp_store = MEMORY;',
    'PRAGMA cache_size = -16000;',
] as const

export interface AnnotationDatabase {
    db: Database.Database
    /** 实际使用的库文件路径 */
    filePath: string
    /** true 表示已降级到扩展缓存目录 */
    degraded: boolean
    /** 本次打开发现库损坏时的留档路径：非 null 时界面必须提示用户数据不可恢复 */
    corruptArchive: string | null
}

/** 按存储根缓存的连接：切换存储根时统一关闭 */
const connections = new Map<string, AnnotationDatabase>()

/** 需要统一 doc_path 口径的表：标注与查询记录都按存储根相对路径保存 */
const DOC_PATH_TABLES = ['annotations', 'editor_queries'] as const

/**
 * 库内 doc_path 口径迁移：早期版本记录的是绝对路径（文档不在工作区内时 asRelativePath 会这样），
 * 与现在的存储根相对路径对不上——不迁移则编辑区读不到旧标注、总览页跳转也会错位。
 * 关键约束：只改能按存储根剥离的绝对路径，剥不动的（存储根之外的文档）原样保留；
 * 相对路径直接跳过，因此每次打开库跑一遍是幂等的。
 */
function migrateDocPaths(db: Database.Database): void {
    const now = new Date().toISOString()
    const invalidate = db.prepare('UPDATE annotations SET orphaned = 1, updated_at = ? WHERE doc_path = ?')
    const migrate = db.transaction((): void => {
        for (const table of DOC_PATH_TABLES) {
            const rows = db.prepare(`SELECT DISTINCT doc_path FROM ${table}`).all() as Array<{ doc_path: string }>
            const update = db.prepare(`UPDATE ${table} SET doc_path = ? WHERE doc_path = ?`)
            for (const row of rows) {
                const normalized = normalizeStoredDocPath(row.doc_path)
                // 只收敛「盘符绝对路径」：相对路径已是目标口径，其它形态交给读取侧兜底
                if (!/^\/[a-z]:\//iu.test(normalized)) {
                    continue
                }
                try {
                    update.run(toStorageRelativePath(normalized, '标注'), row.doc_path)
                } catch {
                    // 存储根之外的历史记录回拼不出来：标注直接判失效，免得列表里点一次才发现打不开
                    if (table === 'annotations') {
                        invalidate.run(now, row.doc_path)
                    }
                }
            }
        }
    })
    migrate()
}

/** 打开指定路径：目录不存在先创建，损坏则留档后新建 */
function openAt(filePath: string): { db: Database.Database; corruptArchive: string | null } {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const openFresh = (): Database.Database => {
        const fresh = new Database(filePath)
        for (const pragma of PRAGMAS) {
            fresh.exec(pragma)
        }
        ensureAnnotationSchema(fresh)
        try {
            migrateDocPaths(fresh)
        } catch (error) {
            // 迁移失败不能拖垮打开流程：旧路径仍可跳转（读取侧兼容绝对路径），只是编辑区可能对不上
            const reason = error instanceof Error ? error.message : String(error)
            logger.warn(`doc_path 口径迁移失败：${filePath}（${reason}）`)
        }
        return fresh
    }
    const db = openFresh()
    try {
        const check = db.pragma('quick_check', { simple: true })
        if (check !== 'ok') {
            throw new Error(`quick_check 未通过：${String(check)}`)
        }
        return { db, corruptArchive: null }
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        logger.error(`标注库损坏，留档后新建：${filePath}（${reason}）`)
        db.close()
        const archive = `${filePath}.corrupt-${String(Date.now())}`
        fs.renameSync(filePath, archive)
        return { db: openFresh(), corruptArchive: archive }
    }
}

/** 库文件的预期绝对路径：设置页与提示文案用，不触发打开 */
export function resolveAnnotationDbPath(root: vscode.Uri): string {
    return path.join(root.fsPath, ANNOTATION_INDEX_DIR, ANNOTATION_DB_FILE)
}

/**
 * 打开当前存储根对应的标注库。
 * @param root 存储根
 * @param cacheRoot 扩展缓存目录：存储根不可写时作为降级位置
 */
export function openAnnotationDatabase(root: vscode.Uri, cacheRoot: vscode.Uri): AnnotationDatabase {
    const key = root.fsPath
    const cached = connections.get(key)
    if (cached !== undefined) {
        return cached
    }
    const primaryPath = resolveAnnotationDbPath(root)
    let opened: AnnotationDatabase
    try {
        const { db, corruptArchive } = openAt(primaryPath)
        opened = { db, filePath: primaryPath, degraded: false, corruptArchive }
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        logger.warn(`标注库打开失败，降级到缓存目录：${primaryPath}（${reason}）`)
        const fallbackPath = path.join(cacheRoot.fsPath, ANNOTATION_DB_FILE)
        const { db, corruptArchive } = openAt(fallbackPath)
        opened = { db, filePath: fallbackPath, degraded: true, corruptArchive }
    }
    connections.set(key, opened)
    return opened
}

/** 关闭全部连接：存储根变更与扩展停用时调用 */
export function closeAnnotationDatabases(): void {
    for (const [key, entry] of connections) {
        try {
            entry.db.close()
        } catch (error) {
            logger.error(`标注库关闭失败：${key}`, error)
        }
    }
    connections.clear()
}
