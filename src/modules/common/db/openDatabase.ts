/**
 * SQLite 连接基座：统一各库文件（index.db / ai.db）的打开方式与 PRAGMA。
 * 约束：库文件位于 globalStorage（不进 Git），调用方负责生命周期与单写连接。
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
 * @param globalStorageUri 插件全局存储目录
 * @param fileName 库文件名，如 index.db / ai.db
 */
export function openSqliteDatabase(globalStorageUri: vscode.Uri, fileName: string): Database.Database {
    const dbPath = path.join(globalStorageUri.fsPath, fileName)
    // 首次激活时 globalStorage 目录可能尚未创建，better-sqlite3 要求父目录存在
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })
    const db = new Database(dbPath)
    for (const pragma of PRAGMAS) {
        db.exec(pragma)
    }
    return db
}
