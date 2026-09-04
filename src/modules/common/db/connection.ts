/**
 * SQLite 连接管理：打开/创建索引库并应用性能 PRAGMA。
 * 约束：索引库仅存元数据、位于 globalStorage（不进 Git）；单写连接 + 进程内互斥由调用方保证。
 */
import * as path from 'node:path'
import * as vscode from 'vscode'
import Database from 'better-sqlite3'

/** 连接初始化 PRAGMA：WAL 提升并发读、NORMAL 平衡 durability 与性能（common.md 第 6 节） */
const PRAGMAS = [
    'PRAGMA journal_mode = WAL;',
    'PRAGMA synchronous = NORMAL;',
    'PRAGMA temp_store = MEMORY;',
    'PRAGMA cache_size = -16000;',
    'PRAGMA foreign_keys = ON;',
] as const

/**
 * 打开（或创建）索引库。
 * @param globalStorageUri 插件全局存储目录，库文件固定为其中的 index.db
 */
export function openIndexDatabase(globalStorageUri: vscode.Uri): Database.Database {
    const dbPath = path.join(globalStorageUri.fsPath, 'index.db')
    const db = new Database(dbPath)
    for (const pragma of PRAGMAS) {
        db.exec(pragma)
    }
    return db
}
