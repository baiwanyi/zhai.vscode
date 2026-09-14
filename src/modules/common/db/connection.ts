/**
 * SQLite 连接管理：打开/创建索引库并应用性能 PRAGMA（基座见 openDatabase.ts）。
 * 约束：索引库仅存元数据、位于 globalStorage（不进 Git）；单写连接 + 进程内互斥由调用方保证。
 */
import { openSqliteDatabase } from './openDatabase'
import type Database from 'better-sqlite3'
import type * as vscode from 'vscode'

/**
 * 打开（或创建）索引库。
 * @param globalStorageUri 插件全局存储目录，库文件固定为其中的 index.db
 */
export function openIndexDatabase(globalStorageUri: vscode.Uri): Database.Database {
    return openSqliteDatabase(globalStorageUri, 'index.db')
}
