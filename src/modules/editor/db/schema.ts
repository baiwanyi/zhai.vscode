/**
 * 标注库 DDL：annotations 主表 + annotations_fts（trigram 中文子串）+ 三个同步触发器。
 * 设计源：docs/plan/编辑区 Markdown 富文本编辑器可行性方案.md 第 8.1 节。
 * 复用约定：与 index.db / media.db 同为 better-sqlite3 手写 DDL，版本号写 user_version；
 * FTS5 虚表与触发器无法用 ORM 表达，必须手写并与主表字段保持一致。
 * 关键约束：block_id / block_hash / quote 三列是重定位的降级链，缺一不可；
 * orphaned 只置位不物理删除，用户可能还要找回这条批注。
 */
import type Database from 'better-sqlite3'

/** 当前 schema 版本：新增列或索引时递增，由 ensureAnnotationSchema 就地迁移 */
const SCHEMA_VERSION = 1

const DDL_STATEMENTS = [
    `CREATE TABLE IF NOT EXISTS annotations (
        id           TEXT PRIMARY KEY,
        doc_path     TEXT    NOT NULL,
        doc_title    TEXT    NOT NULL DEFAULT '',
        kind         TEXT    NOT NULL,
        mode         TEXT    NOT NULL DEFAULT 'inline',
        quote        TEXT    NOT NULL,
        prefix       TEXT    NOT NULL DEFAULT '',
        suffix       TEXT    NOT NULL DEFAULT '',
        start_offset INTEGER NOT NULL DEFAULT 0,
        end_offset   INTEGER NOT NULL DEFAULT 0,
        block_id     TEXT    NOT NULL DEFAULT '',
        block_index  INTEGER NOT NULL DEFAULT 0,
        block_hash   TEXT    NOT NULL DEFAULT '',
        block_text   TEXT    NOT NULL DEFAULT '',
        color        TEXT,
        note         TEXT,
        replies      TEXT    NOT NULL DEFAULT '[]',
        orphaned     INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT    NOT NULL,
        updated_at   TEXT    NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_annotations_doc ON annotations(doc_path)`,
    `CREATE INDEX IF NOT EXISTS idx_annotations_time ON annotations(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_annotations_orphaned ON annotations(orphaned)`,
    // 编辑区查询的缓存与历史：与标注同一个库，省掉第二套连接与生命周期管理。
    // 缓存键为 doc_path + quote + question——不含 block_hash，因为 webview 只上报选区文本；
    // 代价是「选区文字没变、段落其他部分改过」时可能命中旧答案，界面必须标出「来自缓存」。
    `CREATE TABLE IF NOT EXISTS editor_queries (
        id         TEXT PRIMARY KEY,
        doc_path   TEXT NOT NULL,
        quote      TEXT NOT NULL,
        question   TEXT NOT NULL,
        answer     TEXT NOT NULL,
        model      TEXT NOT NULL,
        created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_editor_queries_cache ON editor_queries(doc_path, quote, question)`,
    `CREATE INDEX IF NOT EXISTS idx_editor_queries_time ON editor_queries(created_at DESC)`,
    `CREATE VIRTUAL TABLE IF NOT EXISTS annotations_fts USING fts5(
        id UNINDEXED,
        quote,
        block_text,
        note,
        tokenize = 'trigram'
    )`,
    // FTS 行必须用 rowid 对齐：虚表按 id 文本删除不可靠（unindexed 列不做索引），
    // 更新时会残留旧行，导致旧关键词仍然命中。
    `CREATE TRIGGER IF NOT EXISTS annotations_ai AFTER INSERT ON annotations BEGIN
        INSERT INTO annotations_fts(rowid, id, quote, block_text, note)
        VALUES (new.rowid, new.id, new.quote, new.block_text, COALESCE(new.note, ''));
    END`,
    `CREATE TRIGGER IF NOT EXISTS annotations_ad AFTER DELETE ON annotations BEGIN
        DELETE FROM annotations_fts WHERE rowid = old.rowid;
    END`,
    `CREATE TRIGGER IF NOT EXISTS annotations_au AFTER UPDATE ON annotations BEGIN
        DELETE FROM annotations_fts WHERE rowid = old.rowid;
        INSERT INTO annotations_fts(rowid, id, quote, block_text, note)
        VALUES (new.rowid, new.id, new.quote, new.block_text, COALESCE(new.note, ''));
    END`,
] as const

/** 确保表结构与版本号就位；返回是否为全新建库 */
export function ensureAnnotationSchema(db: Database.Database): boolean {
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
