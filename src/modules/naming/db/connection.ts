/**
 * 取名库连接：打开索引缓存目录下的 naming.db（历史批次与收藏），与 index.db / ai.db 相互独立。
 * 复用约定：沿用 common/db/openDatabase 的统一 PRAGMA 与目录创建逻辑。
 * 关键约束：库文件位于缓存目录，删除后仅丢失取名历史，不影响文档与 AI 会话。
 */
import type Database from 'better-sqlite3'
import type * as vscode from 'vscode'
import { openSqliteDatabase } from '../../common/db/openDatabase'

/** 打开（或创建）取名库 */
export function openNamingDatabase(cacheDirUri: vscode.Uri): Database.Database {
    return openSqliteDatabase(cacheDirUri, 'naming.db')
}
