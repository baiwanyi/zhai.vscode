/**
 * 取名库 DDL：naming_batches（生成批次）与 naming_favorites（收藏）两表。
 * 复用约定：库文件为缓存目录下的 naming.db，与 ai.db 分离；建表语句幂等，激活时直接执行。
 * 关键约束：只存条件快照与结果数组的 JSON 文本，不存提示词与密钥；批次表按时间倒序建索引供历史列表使用。
 */
import type Database from 'better-sqlite3'

const SCHEMA_VERSION = '1'

const DDL_STATEMENTS = [
    `CREATE TABLE IF NOT EXISTS naming_batches (
        id         TEXT PRIMARY KEY,
        category   TEXT NOT NULL,
        source     TEXT NOT NULL,
        params     TEXT NOT NULL,
        results    TEXT NOT NULL,
        created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_naming_created ON naming_batches(created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS naming_favorites (
        name       TEXT NOT NULL,
        category   TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (name, category)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_naming_fav_created ON naming_favorites(created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )`,
] as const

/** 确保取名库 schema 存在；返回是否为全新建库 */
export function ensureNamingSchema(db: Database.Database): boolean {
    const isCreated = db.pragma('user_version', { simple: true }) === 0
    db.transaction(() => {
        for (const ddl of DDL_STATEMENTS) {
            db.exec(ddl)
        }
        db.prepare(
            'INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        ).run('naming_schema_version', SCHEMA_VERSION)
    })()
    return isCreated
}
