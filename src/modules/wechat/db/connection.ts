/**
 * 公众号库连接：打开缓存目录下的 wechat.db，承载账号、推送批次与批次内文章。
 * 复用约定：沿用 common/db/openDatabase 的统一 PRAGMA 与目录创建逻辑，与 index.db / ai.db / press.db 相互独立；
 * 表结构与 docs/modules/wechat.md 第 6 节一致，账号表由本模块自建，不复用微博账号表。
 * 关键约束：库内只存业务元数据，AppSecret 一律进 SecretStorage，任何 DDL 都不得新增密钥列；
 * 正文以存储根下的 Markdown 文件为准（articles.file_path），body 只作镜像供列表统计与文件丢失时排查；
 * 批次的 dir_path 记录其落盘目录，旧批次为空时由服务层按创建时间补建并回写；
 * 账号底座阶段建表时文章表曾用 html 列，数据尚未产生，探测到旧结构直接重建，不做逐列迁移。
 */
import { openSqliteDatabase } from '@modules/common/db/openDatabase'
import type Database from 'better-sqlite3'
import type * as vscode from 'vscode'

/**
 * 账号表：app_id 允许为空串（新建账号先只有设置，凭据之后单独保存）。
 * 唯一性靠部分索引兜住——只约束非空的 AppID，空串可以有多行。
 */
const ACCOUNT_TABLE_DDL = `CREATE TABLE IF NOT EXISTS wechat_accounts (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        avatar          TEXT,
        app_id          TEXT NOT NULL DEFAULT '',
        account_type    TEXT NOT NULL,
        verified        INTEGER NOT NULL DEFAULT 0,
        status          TEXT NOT NULL,
        last_error_code INTEGER,
        status_hint     TEXT,
        fan_count       INTEGER NOT NULL DEFAULT 0,
        issue_count     INTEGER NOT NULL DEFAULT 0,
        last_publish_at TEXT,
        default_author  TEXT,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
    )`

/** 非空 AppID 的唯一索引：空串是「尚未配置」，不参与唯一性 */
const ACCOUNT_APPID_INDEX_DDL = `CREATE UNIQUE INDEX IF NOT EXISTS idx_account_appid
        ON wechat_accounts(app_id) WHERE app_id <> ''`

/** 建表语句：顺序即依赖顺序（账号 → 批次 → 文章） */
const SCHEMA_STATEMENTS = [
    ACCOUNT_TABLE_DDL,
    ACCOUNT_APPID_INDEX_DDL,
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
        updated_at     TEXT NOT NULL,
        dir_path       TEXT                      -- 批次落盘目录（存储根相对路径），正文文件都在这下面
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
        source_path    TEXT,                     -- 导入来源文档（存储根相对路径），只作追溯
        file_path      TEXT,                     -- 批次内正文文件（存储根相对路径），发布内容以它为准
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

/**
 * 迁移账号表的 AppID 约束：列级 UNIQUE 改为部分唯一索引。
 * 关键约束：只在探测到旧结构（origin = 'u' 的唯一索引）时整表搬家，事务内完成，保留全部行；
 * 新建库与已迁移的库直接跳过，重复执行无副作用。
 */
function migrateAccountAppIdIndex(db: Database.Database): void {
    const indexes = db.prepare("PRAGMA index_list('wechat_accounts')").all() as {
        name: string
        unique: number
        origin: string
    }[]
    if (!indexes.some((item) => item.unique === 1 && item.origin === 'u')) {
        return
    }
    db.transaction(() => {
        db.exec('ALTER TABLE wechat_accounts RENAME TO wechat_accounts_legacy')
        // 旧库可能已由 SCHEMA_STATEMENTS 建出同名部分索引，先清掉，避免新表建索引时名称冲突
        db.exec('DROP INDEX IF EXISTS idx_account_appid')
        db.exec(ACCOUNT_TABLE_DDL)
        db.exec(
            `INSERT INTO wechat_accounts
                (id, name, avatar, app_id, account_type, verified, status, last_error_code, status_hint,
                 fan_count, issue_count, last_publish_at, default_author, created_at, updated_at)
             SELECT id, name, avatar, app_id, account_type, verified, status, last_error_code, status_hint,
                    fan_count, issue_count, last_publish_at, default_author, created_at, updated_at
               FROM wechat_accounts_legacy`,
        )
        db.exec('DROP TABLE wechat_accounts_legacy')
        db.exec(ACCOUNT_APPID_INDEX_DDL)
    })()
}

/** 打开（或创建）公众号库，并确保表结构存在 */
export function openWechatDatabase(cacheDirUri: vscode.Uri): Database.Database {
    const db = openSqliteDatabase(cacheDirUri, 'wechat.db')
    dropLegacyArticleTable(db)
    for (const ddl of SCHEMA_STATEMENTS) {
        db.exec(ddl)
    }
    ensureColumn(db, 'wechat_articles', 'cover_path', 'TEXT')
    ensureColumn(db, 'wechat_articles', 'file_path', 'TEXT')
    ensureColumn(db, 'wechat_issues', 'msg_data_id', 'TEXT')
    ensureColumn(db, 'wechat_issues', 'dir_path', 'TEXT')
    // 旧库补列后再迁移索引：迁移语句要读 default_author
    ensureColumn(db, 'wechat_accounts', 'default_author', 'TEXT')
    migrateAccountAppIdIndex(db)
    return db
}
