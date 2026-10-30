/**
 * 公众号库连接：打开缓存目录下的 wechat.db，承载账号、推送批次与批次内文章。
 * 复用约定：沿用 common/db/openDatabase 的统一 PRAGMA 与目录创建逻辑，与 index.db / ai.db / press.db 相互独立；
 * 表结构与 docs/modules/wechat.md 第 6 节一致，账号表由本模块自建，不复用微博账号表。
 * 关键约束：库内只存业务元数据，AppSecret 一律进 SecretStorage，任何 DDL 都不得新增密钥列；
 * 批次与文章表在账号底座阶段一并建好，后续接入编辑与推送时不再对已存在的库做迁移。
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
        html           TEXT NOT NULL,
        html_hash      TEXT NOT NULL,
        cover_media_id TEXT,
        source_kind    TEXT NOT NULL,
        source_path    TEXT,
        is_original    INTEGER NOT NULL DEFAULT 0,
        allow_comment  INTEGER NOT NULL DEFAULT 0,
        read_num       INTEGER NOT NULL DEFAULT 0,
        like_num       INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE INDEX IF NOT EXISTS idx_article_issue ON wechat_articles(issue_id, sort_index)`,
] as const

/** 打开（或创建）公众号库，并确保表结构存在 */
export function openWechatDatabase(cacheDirUri: vscode.Uri): Database.Database {
    const db = openSqliteDatabase(cacheDirUri, 'wechat.db')
    for (const ddl of SCHEMA_STATEMENTS) {
        db.exec(ddl)
    }
    return db
}
