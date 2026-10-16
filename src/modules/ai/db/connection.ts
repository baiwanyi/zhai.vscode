/**
 * AI 库连接：打开索引缓存目录（全局存储下的 zhai.vscode）中的 ai.db（会话、消息与用量），与内容索引库分离。
 * 设计源：docs/modules/ai-chat.md 第 6 节——AI 写入频繁，独立成库避免影响索引写入。
 */
import type Database from 'better-sqlite3'
import type * as vscode from 'vscode'
import { openSqliteDatabase } from '../../common/db/openDatabase'

/** 打开（或创建）AI 会话库 */
export function openAiDatabase(cacheDirUri: vscode.Uri): Database.Database {
    return openSqliteDatabase(cacheDirUri, 'ai.db')
}
