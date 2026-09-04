/**
 * 索引库 DDL：files 元数据主表 + files_fts 全文虚表（trigram 中文子串）+ 同步触发器。
 * 设计源：docs/modules/common.md 第 6 节；FTS5 虚表与触发器必须手写 DDL，Drizzle 无法表达。
 */
import type Database from 'better-sqlite3'

const SCHEMA_VERSION = '1'

const DDL_STATEMENTS = [
    `CREATE TABLE IF NOT EXISTS files (
        path        TEXT PRIMARY KEY,
        title       TEXT NOT NULL,
        word_count  INTEGER NOT NULL DEFAULT 0,
        tags        TEXT    NOT NULL DEFAULT '[]',
        characters  TEXT    NOT NULL DEFAULT '[]',
        summary     TEXT,
        hash        TEXT,
        mtime       TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_files_mtime ON files(mtime DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_files_updated ON files(updated_at DESC)`,
    `CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
        path UNINDEXED,
        title,
        tags,
        summary,
        tokenize = 'trigram'
    )`,
    `CREATE TRIGGER IF NOT EXISTS files_ai AFTER INSERT ON files BEGIN
        INSERT INTO files_fts(path, title, tags, summary)
        VALUES (new.path, new.title, new.tags, COALESCE(new.summary, ''));
    END`,
    `CREATE TRIGGER IF NOT EXISTS files_ad AFTER DELETE ON files BEGIN
        DELETE FROM files_fts WHERE path = old.path;
    END`,
    `CREATE TRIGGER IF NOT EXISTS files_au AFTER UPDATE ON files BEGIN
        UPDATE files_fts
           SET title = new.title, tags = new.tags, summary = COALESCE(new.summary, '')
         WHERE path = new.path;
    END`,
    `CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )`,
] as const

/** 确保 schema 存在并写入/校验 schema_version；返回是否为全新建库 */
export function ensureSchema(db: Database.Database): boolean {
    const created = db.pragma('user_version', { simple: true }) === 0
    db.transaction(() => {
        for (const ddl of DDL_STATEMENTS) {
            db.exec(ddl)
        }
        db.prepare(
            'INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        ).run('schema_version', SCHEMA_VERSION)
        if (created) {
            db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)').run('built_at', new Date().toISOString())
        }
    })()
    return created
}

/** 清空全部索引数据（保留 schema），供「清空索引缓存」命令使用 */
export function clearSchemaData(db: Database.Database): void {
    db.exec('DELETE FROM files; DELETE FROM files_fts; DELETE FROM meta;')
}
