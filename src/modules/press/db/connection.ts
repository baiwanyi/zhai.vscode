/**
 * 写作管理库连接：打开缓存目录下的 press.db，承载写作管理模块的宿主侧状态。
 * 复用约定：沿用 common/db/openDatabase 的统一 PRAGMA 与目录创建逻辑；meta 表存 AI 配额计数与作品封面选择，
 * 与 index.db / ai.db / naming.db 相互独立，避免一次性任务的计数污染主库。
 * 关键约束：库文件位于缓存目录，删除后仅丢失配额计数与封面选择，不影响文档、人物卡与已落盘的图片。
 */
import type Database from 'better-sqlite3'
import type * as vscode from 'vscode'
import { openSqliteDatabase } from '../../common/db/openDatabase'

/** meta 表：键值对，保存日期与计数等轻量状态 */
const SCHEMA_STATEMENTS = [
    `CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )`,
] as const

/** 打开（或创建）写作管理库，并确保 meta 表存在 */
export function openPressDatabase(cacheDirUri: vscode.Uri): Database.Database {
    const db = openSqliteDatabase(cacheDirUri, 'press.db')
    for (const ddl of SCHEMA_STATEMENTS) {
        db.exec(ddl)
    }
    return db
}
