/**
 * SQLite 连接基座：统一各库文件（index.db / ai.db）的打开方式与 PRAGMA。
 * 约束：库文件位于全局存储下的 zhai.vscode 缓存目录（不进 Git），调用方负责生命周期与单写连接。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import Database from 'better-sqlite3'
import type * as vscode from 'vscode'

/** 连接初始化 PRAGMA：WAL 提升并发读、NORMAL 平衡 durability 与性能（common.md 第 6 节） */
const PRAGMAS = [
    'PRAGMA journal_mode = WAL;',
    'PRAGMA synchronous = NORMAL;',
    'PRAGMA temp_store = MEMORY;',
    'PRAGMA cache_size = -16000;',
    'PRAGMA foreign_keys = ON;',
] as const

/**
 * 打开（或创建）globalStorage 下的某个 SQLite 库。
 * @param cacheDirUri 索引缓存目录（全局存储下的 zhai.vscode）
 * @param fileName 库文件名，如 index.db / ai.db
 */
export function openSqliteDatabase(cacheDirUri: vscode.Uri, fileName: string): Database.Database {
    const dbPath = path.join(cacheDirUri.fsPath, fileName)
    // 首次激活时缓存目录可能尚未创建，better-sqlite3 要求父目录存在
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    const db = new Database(dbPath)
    for (const pragma of PRAGMAS) {
        db.exec(pragma)
    }
    return db
}
