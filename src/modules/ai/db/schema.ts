/**
 * AI 库 DDL：conversations（会话）/ messages（消息）/ ai_usage_logs（用量）三表与索引。
 * 设计源：docs/modules/ai-chat.md 第 6 节；日志表只存模型与用量，不存提示词正文。
 * 复用约定：activate 期调用一次，建表与补列都走 IF NOT EXISTS / PRAGMA 判断，可重复执行。
 * 关键约束：会话记录所属 AI 通道与通道侧会话号，通道切换后不得复用旧会话号；
 * 补列的标识符均为本文件内的常量，不接受外部输入，避免拼接注入。
 */
import type Database from 'better-sqlite3'

const SCHEMA_VERSION = '2'

const DDL_STATEMENTS = [
    `CREATE TABLE IF NOT EXISTS conversations (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL,
        mode        TEXT NOT NULL,
        file_path   TEXT,
        model       TEXT NOT NULL,
        provider    TEXT NOT NULL DEFAULT 'deepseek',
        sdk_session_id TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_conv_updated ON conversations(updated_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_conv_file ON conversations(file_path)`,
    `CREATE TABLE IF NOT EXISTS messages (
        id              TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role            TEXT NOT NULL,
        content         TEXT NOT NULL,
        reasoning       TEXT,
        status          TEXT NOT NULL,
        finish_reason   TEXT,
        refs            TEXT NOT NULL DEFAULT '[]',
        error           TEXT,
        created_at      TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, created_at)`,
    `CREATE TABLE IF NOT EXISTS ai_usage_logs (
        id                TEXT PRIMARY KEY,
        conversation_id   TEXT,
        project           TEXT NOT NULL,
        model             TEXT NOT NULL,
        prompt_tokens     INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        reasoning_tokens  INTEGER NOT NULL DEFAULT 0,
        total_tokens      INTEGER NOT NULL DEFAULT 0,
        estimated_cost    REAL    NOT NULL DEFAULT 0,
        latency_ms        INTEGER NOT NULL DEFAULT 0,
        created_at        TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_usage_date ON ai_usage_logs(created_at)`,
    `CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )`,
] as const

/** 旧库补列：SQLite 的 ADD COLUMN 没有 IF NOT EXISTS，只能先查 PRAGMA 再执行 */
function ensureColumn(db: Database.Database, table: string, name: string, definition: string): void {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    if (!columns.some((item) => item.name === name)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`)
    }
}

/** 确保 AI 库 schema 存在并写入 schema_version；返回是否为全新建库 */
export function ensureAiSchema(db: Database.Database): boolean {
    const isCreated = db.pragma('user_version', { simple: true }) === 0
    db.transaction(() => {
        for (const ddl of DDL_STATEMENTS) {
            db.exec(ddl)
        }
        // v2：会话记录所属通道与通道侧会话号，供 CodeBuddy 通道续接
        ensureColumn(db, 'conversations', 'provider', "provider TEXT NOT NULL DEFAULT 'deepseek'")
        ensureColumn(db, 'conversations', 'sdk_session_id', 'sdk_session_id TEXT')
        db.prepare(
            'INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        ).run('schema_version', SCHEMA_VERSION)
    })()
    return isCreated
}
