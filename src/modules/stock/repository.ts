/**
 * 在线图库仓储：stock_photos 表的读写，是服务层与对账唯一的 SQL 出口。
 * 复用约定：路径一律传存储根相对路径（unsplash/{YYYYMM}/{photoId}.{ext}），月份由路径第二段推导；
 * 写入用 UPSERT 纠正路径与丢失标记，读出的行由服务层拼 url 后转成协议条目。
 * 关键约束：photo_id 是主键也是去重键，撞键时只更新路径类字段——署名、来源、首次下载时间与 scope 是不可改写的历史事实；
 * 缺失的文件只标 missing，不删行，否则署名与来源一起丢。
 */
import type { MediaScope } from '@shared/types/media'
import { STOCK_DIR } from '@shared/types/stock'
import type Database from 'better-sqlite3'

/** 待写入的图片记录：photoId 即主键 */
export interface StockPhotoRecord {
    photoId: string
    /** 存储根相对路径：unsplash/202611/Kq2WnB6x9eA.jpg */
    path: string
    ext: string
    byteSize: number
    width: number | null
    height: number | null
    alt: string
    photographer: string | null
    photographerUrl: string | null
    downloadLocation: string | null
    scope: MediaScope
    downloadedAt: string
}

/** 仓储读出的图片：带丢失标记 */
export interface StoredStockPhoto extends StockPhotoRecord {
    missing: boolean
}

/** 表行：字段名与建表语句一一对应 */
interface StockPhotoRow {
    photo_id: string
    rel_path: string
    ext: string
    bytes: number
    width: number | null
    height: number | null
    alt: string
    photographer: string | null
    photographer_url: string | null
    download_location: string | null
    scope: string
    downloaded_at: string
    missing: number
}

/** scope 收窄：库内出现未知值时按 general 处理，不让脏数据打断列表 */
function readScope(value: string): MediaScope {
    return value === 'press' || value === 'note' || value === 'wechat' ? value : 'general'
}

/** 行 → 记录 */
function toRecord(row: StockPhotoRow): StoredStockPhoto {
    return {
        photoId: row.photo_id,
        path: row.rel_path,
        ext: row.ext,
        byteSize: row.bytes,
        width: row.width,
        height: row.height,
        alt: row.alt,
        photographer: row.photographer,
        photographerUrl: row.photographer_url,
        downloadLocation: row.download_location,
        scope: readScope(row.scope),
        downloadedAt: row.downloaded_at,
        missing: row.missing === 1,
    }
}

/**
 * 写入或纠正一条记录。
 * 关键约束：撞主键时只更新路径、体积、尺寸与丢失标记；署名与来源用 COALESCE 补齐而不覆盖，
 * scope 与 downloaded_at 保持首次写入值。
 */
export function insertStockPhoto(db: Database.Database, record: StockPhotoRecord): void {
    db.prepare(
        `INSERT INTO stock_photos (
            photo_id, rel_path, ext, bytes, width, height, alt,
            photographer, photographer_url, download_location, scope, downloaded_at, missing
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(photo_id) DO UPDATE SET
            rel_path = excluded.rel_path,
            ext = excluded.ext,
            bytes = excluded.bytes,
            width = COALESCE(excluded.width, stock_photos.width),
            height = COALESCE(excluded.height, stock_photos.height),
            alt = CASE WHEN excluded.alt <> '' THEN excluded.alt ELSE stock_photos.alt END,
            photographer = COALESCE(excluded.photographer, stock_photos.photographer),
            photographer_url = COALESCE(excluded.photographer_url, stock_photos.photographer_url),
            download_location = COALESCE(excluded.download_location, stock_photos.download_location),
            missing = 0`,
    ).run(
        record.photoId,
        record.path,
        record.ext,
        record.byteSize,
        record.width,
        record.height,
        record.alt,
        record.photographer,
        record.photographerUrl,
        record.downloadLocation,
        record.scope,
        record.downloadedAt,
    )
}

/** 按标识取一条：不存在返回 null */
export function findStockPhoto(db: Database.Database, photoId: string): StoredStockPhoto | null {
    const row = db.prepare('SELECT * FROM stock_photos WHERE photo_id = ?').get(photoId) as StockPhotoRow | undefined
    return row === undefined ? null : toRecord(row)
}

/** 列出全部记录：month 为 null 时返回全库，按年月与下载时间倒序 */
export function listStockPhotos(db: Database.Database, month: string | null): StoredStockPhoto[] {
    const monthDir = month === null ? null : month.replace('-', '')
    const rows =
        monthDir === null
            ? (db.prepare('SELECT * FROM stock_photos ORDER BY rel_path DESC').all() as StockPhotoRow[])
            : (db
                  .prepare('SELECT * FROM stock_photos WHERE rel_path LIKE ? ORDER BY rel_path DESC')
                  .all(`${STOCK_DIR}/${monthDir}/%`) as StockPhotoRow[])
    return rows.map(toRecord)
}

/** 年月聚合：只统计仍在磁盘上的条目，供下拉选项与分组头使用 */
export function listStockMonths(db: Database.Database): { month: string; count: number }[] {
    // 年月取路径第一段之后的前 6 位：用 instr 定位分隔符，不依赖目录名字符数
    const rows = db
        .prepare(
            `SELECT substr(rel_path, instr(rel_path, '/') + 1, 6) AS month_dir, COUNT(*) AS count
             FROM stock_photos
             WHERE missing = 0
             GROUP BY month_dir
             ORDER BY month_dir DESC`,
        )
        .all() as { month_dir: string; count: number }[]
    return rows.map((row) => ({
        month: `${row.month_dir.slice(0, 4)}-${row.month_dir.slice(4, 6)}`,
        count: row.count,
    }))
}

/** 全库条数：状态栏与页头计数用 */
export function countStockPhotos(db: Database.Database): number {
    const row = db.prepare('SELECT COUNT(*) AS total FROM stock_photos WHERE missing = 0').get() as { total: number }
    return row.total
}

/** 标记丢失：文件被外部删除或目录被整体清空时使用，不删行 */
export function markStockPhotoMissing(db: Database.Database, photoId: string, missing: boolean): void {
    db.prepare('UPDATE stock_photos SET missing = ? WHERE photo_id = ?').run(missing ? 1 : 0, photoId)
}

/** 删除一条：调用方负责先删文件 */
export function deleteStockPhoto(db: Database.Database, photoId: string): void {
    db.prepare('DELETE FROM stock_photos WHERE photo_id = ?').run(photoId)
}
