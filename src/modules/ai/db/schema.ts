/**
 * AI 库 DDL：conversations（会话）/ messages（消息）/ ai_usage_logs（用量）三表与索引。
 * 设计源：docs/modules/ai-chat.md 第 6 节；日志表只存模型与用量，不存提示词正文。
 */
import type Database from 'better-sqlite3'

const SCHEMA_VERSION = '1'

const DDL_STATEMENTS = [
    `CREATE TABLE IF NOT EXISTS conversations (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL,
        mode        TEXT NOT NULL,
        file_path   TEXT,
        model       TEXT NOT NULL,
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

/** 确保 AI 库 schema 存在并写入 schema_version；返回是否为全新建库 */
export function ensureAiSchema(db: Database.Database): boolean {
    const isCreated = db.pragma('user_version', { simple: true }) === 0
    db.transaction(() => {
        for (const ddl of DDL_STATEMENTS) {
            db.exec(ddl)
        }
        db.prepare(
            'INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        ).run('schema_version', SCHEMA_VERSION)
    })()
    return isCreated
}
