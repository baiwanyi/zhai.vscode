/**
 * 媒体索引库 DDL：media 主表 + media_usage 引用表 + media_meta 键值表。
 * 复用约定：与 index.db / press.db 同为 better-sqlite3 手写 DDL（Drizzle 无法表达部分索引与约束），
 * 版本号写 user_version，迁移标记写 media_meta，避免再引入一张表。
 * 关键约束：media_usage 的唯一键保证「同一张图 × 同一引用方」只有一行，重复扫描不产生重复记录；
 * 出处列（press_path / character / lore）写入后不可更新，对象删除后靠快照继续展示；
 * usage 表不建外键级联——删除媒体时由服务层显式清理，避免删表行时连带丢失引用审计。
 */
import type Database from 'better-sqlite3'

/** 索引结构版本：新增列或索引时递增，供将来做结构迁移 */
const SCHEMA_VERSION = 1

const DDL_STATEMENTS = [
    `CREATE TABLE IF NOT EXISTS media (
        id             TEXT PRIMARY KEY,
        path           TEXT NOT NULL UNIQUE,
        ext            TEXT NOT NULL,
        byte_size      INTEGER NOT NULL DEFAULT 0,
        width          INTEGER,
        height         INTEGER,
        month          TEXT NOT NULL,
        created_at     TEXT NOT NULL,
        scope          TEXT NOT NULL DEFAULT 'general',
        origin         TEXT NOT NULL DEFAULT 'import',
        kind           TEXT NOT NULL DEFAULT 'unknown',
        press_path     TEXT,
        press_name     TEXT,
        character_id   TEXT,
        character_name TEXT,
        lore_kind      TEXT,
        lore_id        TEXT,
        lore_name      TEXT,
        prompt         TEXT,
        ratio          TEXT,
        style          TEXT,
        enhanced_from  TEXT,
        missing        INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE INDEX IF NOT EXISTS idx_media_month ON media(month DESC, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_media_owner ON media(press_path, character_id, lore_kind, lore_id)`,
    `CREATE INDEX IF NOT EXISTS idx_media_scope ON media(scope, month DESC)`,
    `CREATE TABLE IF NOT EXISTS media_usage (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        media_id   TEXT NOT NULL,
        ref_type   TEXT NOT NULL,
        ref_path   TEXT NOT NULL,
        ref_scope  TEXT NOT NULL DEFAULT 'storage',
        ref_id     TEXT,
        ref_title  TEXT,
        ref_anchor TEXT,
        seen_at    TEXT NOT NULL,
        UNIQUE(media_id, ref_type, ref_path, ref_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_usage_media ON media_usage(media_id)`,
    `CREATE INDEX IF NOT EXISTS idx_usage_ref ON media_usage(ref_path)`,
    `CREATE INDEX IF NOT EXISTS idx_usage_type ON media_usage(ref_type)`,
    `CREATE TABLE IF NOT EXISTS media_meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )`,
] as const

/** 确保表结构与版本号就位；返回是否为全新建库 */
export function ensureMediaSchema(db: Database.Database): boolean {
    const isCreated = db.pragma('user_version', { simple: true }) === 0
    db.transaction(() => {
        for (const ddl of DDL_STATEMENTS) {
            db.exec(ddl)
        }
        if (isCreated) {
            db.pragma(`user_version = ${String(SCHEMA_VERSION)}`)
        }
    })()
    return isCreated
}
