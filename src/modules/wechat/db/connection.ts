/**
 * 公众号库连接：打开缓存目录下的 wechat.db，承载账号、推送批次与批次内文章。
 * 复用约定：沿用 common/db/openDatabase 的统一 PRAGMA 与目录创建逻辑，与 index.db / ai.db / press.db 相互独立；
 * 表结构与 docs/modules/wechat.md 第 6 节一致，账号表由本模块自建，不复用微博账号表。
 * 关键约束：库内只存业务元数据，AppSecret 一律进 SecretStorage，任何 DDL 都不得新增密钥列；
 * 文章只存 Markdown 源文（body），内联样式 HTML 在推送前统一渲染，模板变更因此无需重新导入；
 * 账号底座阶段建表时文章表曾用 html 列，数据尚未产生，探测到旧结构直接重建，不做逐列迁移。
 */
import { openSqliteDatabase } from '@modules/common/db/openDatabase'
import type Database from 'better-sqlite3'
import type * as vscode from 'vscode'

/** 建表语句：顺序即依赖顺序（账号 → 批次 → 文章） */
const SCHEMA_STATEMENTS = [
    `CREATE TABLE IF NOT EXISTS wechat_accounts (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        avatar          TEXT,
        app_id          TEXT NOT NULL UNIQUE,
        account_type    TEXT NOT NULL,
        verified        INTEGER NOT NULL DEFAULT 0,
        status          TEXT NOT NULL,
        last_error_code INTEGER,
        status_hint     TEXT,
        fan_count       INTEGER NOT NULL DEFAULT 0,
        issue_count     INTEGER NOT NULL DEFAULT 0,
        last_publish_at TEXT,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS wechat_issues (
        id             TEXT PRIMARY KEY,
        account_id     TEXT NOT NULL,
        title          TEXT NOT NULL,
        cover_url      TEXT,
        cover_media_id TEXT,
        article_count  INTEGER NOT NULL DEFAULT 0,
        status         TEXT NOT NULL,
        media_id       TEXT,
        publish_id     TEXT,
        msg_data_id    TEXT,                     -- 群发消息标识：留言接口按它 + 文章序号定位
        article_url    TEXT,
        error_code     INTEGER,
        error_hint     TEXT,
        scheduled_at   TEXT,
        published_at   TEXT,
        updated_at     TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_issue_account ON wechat_issues(account_id, updated_at DESC)`,
    `CREATE TABLE IF NOT EXISTS wechat_articles (
        id             TEXT PRIMARY KEY,
        issue_id       TEXT NOT NULL,
        sort_index     INTEGER NOT NULL,
        title          TEXT NOT NULL,
        author         TEXT,
        digest         TEXT,
        body           TEXT NOT NULL,
        body_hash      TEXT NOT NULL,
        word_count     INTEGER NOT NULL DEFAULT 0,
        cover_path     TEXT,                     -- 指定的封面图（存储根相对或绝对路径），推送时上传
        cover_media_id TEXT,
        source_kind    TEXT NOT NULL,
        source_path    TEXT,
        is_original    INTEGER NOT NULL DEFAULT 0,
        allow_comment  INTEGER NOT NULL DEFAULT 0,
        read_num       INTEGER NOT NULL DEFAULT 0,
        like_num       INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE INDEX IF NOT EXISTS idx_article_issue ON wechat_articles(issue_id, sort_index)`,
    `CREATE TABLE IF NOT EXISTS wechat_materials (
        id          TEXT PRIMARY KEY,
        account_id  TEXT NOT NULL,
        local_hash  TEXT NOT NULL,
        media_id    TEXT NOT NULL,
        url         TEXT NOT NULL,
        type        TEXT NOT NULL,
        name        TEXT,
        size_bytes  INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL,
        UNIQUE(account_id, local_hash, type)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_material_hash ON wechat_materials(account_id, local_hash)`,
] as const

/**
 * 清理账号底座阶段的旧文章表：当时的列是 html / html_hash，尚无任何写入路径。
 * 关键约束：只认 html 列作为旧结构标识，其它差异走正常 DDL 演进，避免误删真实数据。
 */
function dropLegacyArticleTable(db: Database.Database): void {
    const columns = db.prepare('PRAGMA table_info(wechat_articles)').all() as { name: string }[]
    if (columns.length === 0 || !columns.some((column) => column.name === 'html')) {
        return
    }
    db.exec('DROP TABLE wechat_articles')
}

/**
 * 补齐增量列：CREATE TABLE IF NOT EXISTS 不会改动已存在的表，
 * 旧库升级时用 ALTER TABLE 加列（SQLite 对 ADD COLUMN 的限制最小，不需要重建表）。
 * 关键约束：逐列探测，已有该列直接跳过；空表（列数为 0）说明 DDL 刚建好，无需补列。
 */
function ensureColumn(db: Database.Database, table: string, column: string, definition: string): void {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    if (columns.length === 0 || columns.some((item) => item.name === column)) {
        return
    }
    // 表名与列名来自本文件的常量，不含外部输入，拼接是安全的
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

/** 打开（或创建）公众号库，并确保表结构存在 */
export function openWechatDatabase(cacheDirUri: vscode.Uri): Database.Database {
    const db = openSqliteDatabase(cacheDirUri, 'wechat.db')
    dropLegacyArticleTable(db)
    for (const ddl of SCHEMA_STATEMENTS) {
        db.exec(ddl)
    }
    ensureColumn(db, 'wechat_articles', 'cover_path', 'TEXT')
    ensureColumn(db, 'wechat_issues', 'msg_data_id', 'TEXT')
    return db
}
