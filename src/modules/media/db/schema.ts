/**
 * 媒体索引库 DDL：media 主表 + media_usage 引用表 + media_meta 键值表。
 * 复用约定：与 index.db / press.db 同为 better-sqlite3 手写 DDL（Drizzle 无法表达部分索引与约束），
 * 版本号写 user_version，迁移标记写 media_meta，避免再引入一张表。
 * 关键约束：media_usage 的唯一键保证「同一张图 × 同一引用方」只有一行，重复扫描不产生重复记录；
 * 出图参数（prompt / ratio / style / enhanced_from）不在索引库里——它们落图片同目录的 settings.json，
 * 旧库由服务层导出后调用 dropLegacyParameterColumns 移除这四列，此后只认 json；
 * usage 表不建外键级联——删除媒体时由服务层显式清理，避免删表行时连带丢失引用审计。
 */
import type Database from 'better-sqlite3'

/** 索引结构版本：新增列或索引时递增，供将来做结构迁移 */
const SCHEMA_VERSION = 2

/** 旧库遗留的出图参数列：升级时导出到磁盘后移除 */
export const LEGACY_PARAMETER_COLUMNS = ['prompt', 'ratio', 'style', 'enhanced_from'] as const

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
        origin         TEXT NOT NULL DEFAULT 'upload',
        kind           TEXT NOT NULL DEFAULT 'unknown',
        press_path     TEXT,
        press_name     TEXT,
        character_id   TEXT,
        character_name TEXT,
        lore_kind      TEXT,
        lore_id        TEXT,
        lore_name      TEXT,
        missing        INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE INDEX IF NOT EXISTS idx_media_month ON media(month DESC, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_media_owner ON media(press_path, character_id, lore_kind, lore_id)`,
    `CREATE INDEX IF NOT EXISTS idx_media_scope ON media(scope, month DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_media_origin ON media(origin, month DESC)`,
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

/** 旧库的入库方式只有两档：历史 import / migrate 一律折算为 upload */
const LEGACY_ORIGIN_FIX = "UPDATE media SET origin = 'upload' WHERE origin NOT IN ('generate', 'upload')"

/**
 * 确保表结构与版本号就位；返回是否为全新建库。
 * 旧库在这里只做入库方式收敛（纯 SQL、幂等），参数列的导出与移除需要写磁盘，交给服务层完成。
 */
export function ensureMediaSchema(db: Database.Database): boolean {
    const isCreated = db.pragma('user_version', { simple: true }) === 0
    db.transaction(() => {
        for (const ddl of DDL_STATEMENTS) {
            db.exec(ddl)
        }
        db.exec(LEGACY_ORIGIN_FIX)
        if (isCreated) {
            db.pragma(`user_version = ${SCHEMA_VERSION}`)
        }
    })()
    return isCreated
}

/** 索引库里是否还留有旧参数列 */
export function hasLegacyParameterColumns(db: Database.Database): boolean {
    const columns = db.pragma('table_info(media)') as { name: string }[]
    return LEGACY_PARAMETER_COLUMNS.some((name) => columns.some((column) => column.name === name))
}

/** 移除旧参数列并把结构版本推进到最新：调用方必须先确认数据已导出到磁盘 */
export function dropLegacyParameterColumns(db: Database.Database): void {
    db.transaction(() => {
        if (hasLegacyParameterColumns(db)) {
            for (const name of LEGACY_PARAMETER_COLUMNS) {
                db.exec(`ALTER TABLE media DROP COLUMN ${name}`)
            }
        }
        db.pragma(`user_version = ${SCHEMA_VERSION}`)
    })()
}
