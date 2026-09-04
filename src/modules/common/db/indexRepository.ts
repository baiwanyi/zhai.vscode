/**
 * 索引仓储：files / files_fts 的参数化读写访问层。
 * 安全约束：全部 SQL 使用预编译参数绑定，禁止字符串拼接；批量写入统一走事务。
 */
import type Database from 'better-sqlite3'
import type { FileMeta } from './fileMeta'

/** files 表一行元数据 */
export interface FileRow extends FileMeta {
    path: string
    mtime: string
}

const UPSERT_SQL = `
    INSERT INTO files (path, title, word_count, tags, characters, summary, hash, mtime, created_at, updated_at)
    VALUES (@path, @title, @wordCount, @tags, '[]', NULL, @hash, @mtime, @now, @now)
    ON CONFLICT(path) DO UPDATE SET
        title = excluded.title,
        word_count = excluded.word_count,
        tags = excluded.tags,
        hash = excluded.hash,
        mtime = excluded.mtime,
        updated_at = excluded.updated_at
`

/** 批量 upsert 元数据（单事务），供增量索引与全量重建共用 */
export function upsertFileRows(db: Database.Database, rows: FileRow[]): void {
    const statement = db.prepare(UPSERT_SQL)
    db.transaction(() => {
        for (const row of rows) {
            statement.run({
                path: row.path,
                title: row.title,
                wordCount: row.wordCount,
                tags: JSON.stringify(row.tags),
                hash: row.hash,
                mtime: row.mtime,
                now: new Date().toISOString(),
            })
        }
    })()
}

/** 按相对路径删除记录（触发器同步删除 FTS 行） */
export function deleteFileRow(db: Database.Database, path: string): void {
    db.prepare('DELETE FROM files WHERE path = ?').run(path)
}

/** 统计 files 表记录数（激活自检用） */
export function countFileRows(db: Database.Database): number {
    const row = db.prepare('SELECT COUNT(*) AS count FROM files').get() as { count: number } | undefined
    return row?.count ?? 0
}

/** 读取全部记录的 path 与 mtime，用于全量重建前比对与漂移检测 */
export function listIndexedPaths(db: Database.Database): Map<string, string> {
    const rows = db.prepare('SELECT path, mtime FROM files').all() as Array<{ path: string; mtime: string }>
    return new Map(rows.map((row) => [row.path, row.mtime]))
}

export interface SearchHit {
    path: string
    title: string
    tags: string[]
    /** FTS5 highlight() 处理后的片段 */
    snippet: string
}

/**
 * FTS5 全文检索：trigram 分词器下 MATCH 命中中文子串。
 * @param keyword 用户关键词，连续子串即可命中
 */
export function searchFiles(db: Database.Database, keyword: string, limit: number): SearchHit[] {
    const escaped = keyword.replace(/["*]/g, ' ').trim()
    if (escaped.length === 0) {
        return []
    }
    const rows = db
        .prepare(
            `SELECT path, title, tags,
                    highlight(files_fts, 1, '【', '】') AS snippet
             FROM files_fts
             WHERE files_fts MATCH ?
             LIMIT ?`,
        )
        .all(escaped, limit) as Array<{ path: string; title: string; tags: string; snippet: string }>
    return rows.map((row) => ({
        path: row.path,
        title: row.title,
        tags: safeParseTags(row.tags),
        snippet: row.snippet,
    }))
}

function safeParseTags(raw: string): string[] {
    try {
        const parsed: unknown = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : []
    } catch {
        return []
    }
}
