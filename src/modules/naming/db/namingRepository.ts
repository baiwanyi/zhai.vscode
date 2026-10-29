/**
 * 取名仓储：naming_batches / naming_favorites 的参数化读写，供历史列表与收藏功能使用。
 * 复用约定：全部 SQL 使用预编译参数绑定；批次按插入顺序裁剪，只保留最近 N 条。
 * 关键约束：结果与条件以 JSON 文本落库，读取时由服务层解析并校验；收藏以 (name, category) 为主键，重复收藏不报错。
 */
import type Database from 'better-sqlite3'

/** naming_batches 表一行 */
export interface NamingBatchRow {
    id: string
    category: string
    source: string
    /** 条件快照（JSON） */
    params: string
    /** 名字数组（JSON） */
    results: string
    createdAt: string
}

/** naming_favorites 表一行 */
export interface NamingFavoriteRow {
    name: string
    category: string
    createdAt: string
}

const BATCH_COLUMNS = `id, category, source, params, results, created_at AS createdAt`

const FAVORITE_COLUMNS = `name, category, created_at AS createdAt`

/** 写入一批生成结果 */
export function insertBatch(db: Database.Database, row: NamingBatchRow): void {
    db.prepare(
        `INSERT INTO naming_batches (id, category, source, params, results, created_at)
         VALUES (@id, @category, @source, @params, @results, @createdAt)`,
    ).run(row)
}

/** 历史批次：按时间倒序 */
export function listBatches(db: Database.Database, limit: number): NamingBatchRow[] {
    return db
        .prepare(`SELECT ${BATCH_COLUMNS} FROM naming_batches ORDER BY created_at DESC LIMIT ?`)
        .all(limit) as NamingBatchRow[]
}

/** 清空历史，保留最近 keep 条 */
export function trimBatches(db: Database.Database, keep: number): number {
    const result = db
        .prepare(
            `DELETE FROM naming_batches WHERE id NOT IN (
                SELECT id FROM naming_batches ORDER BY created_at DESC LIMIT ?
            )`,
        )
        .run(keep)
    return result.changes
}

/** 清空全部历史 */
export function clearBatches(db: Database.Database): number {
    return db.prepare('DELETE FROM naming_batches').run().changes
}

/** 收藏：已存在时不重复写入 */
export function insertFavorite(db: Database.Database, row: NamingFavoriteRow): void {
    db.prepare(
        `INSERT INTO naming_favorites (name, category, created_at) VALUES (@name, @category, @createdAt)
         ON CONFLICT(name, category) DO NOTHING`,
    ).run(row)
}

/** 取消收藏；返回是否真的删除 */
export function deleteFavorite(db: Database.Database, name: string, category: string): boolean {
    return db.prepare('DELETE FROM naming_favorites WHERE name = ? AND category = ?').run(name, category).changes > 0
}

/** 判断是否已收藏 */
export function isFavorite(db: Database.Database, name: string, category: string): boolean {
    return (
        db.prepare('SELECT 1 FROM naming_favorites WHERE name = ? AND category = ?').get(name, category) !== undefined
    )
}

/** 收藏列表 */
export function listFavorites(db: Database.Database, limit: number): NamingFavoriteRow[] {
    return db
        .prepare(`SELECT ${FAVORITE_COLUMNS} FROM naming_favorites ORDER BY created_at DESC LIMIT ?`)
        .all(limit) as NamingFavoriteRow[]
}

/** 读取 meta 值：不存在返回 null */
export function readMeta(db: Database.Database, key: string): string | null {
    const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined
    return row ? row.value : null
}

/** 写入 meta 值（覆盖） */
export function writeMeta(db: Database.Database, key: string, value: string): void {
    db.prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
        key,
        value,
    )
}
