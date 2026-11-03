/**
 * 在线图库表结构：单表 stock_photos，以 photoId 为主键承载本地副本的全部已知事实。
 * 复用约定：rel_path 一律为存储根相对路径，与媒体库同一口径；月份由路径推导，不单独存列。
 * 关键约束：photo_id 同时是文件名主干，主键即去重键——同一张图不可能有两行；
 * 表只增不删语义明确：文件丢失标 missing，行保留署名与来源，不做物理清理。
 */
import type Database from 'better-sqlite3'

/** 建表与索引：可重复执行，打开连接时调用一次 */
export function ensureStockSchema(db: Database.Database): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS stock_photos (
            photo_id          TEXT PRIMARY KEY,
            rel_path          TEXT NOT NULL UNIQUE,
            ext               TEXT NOT NULL,
            bytes             INTEGER NOT NULL DEFAULT 0,
            width             INTEGER,
            height            INTEGER,
            alt               TEXT NOT NULL DEFAULT '',
            photographer      TEXT,
            photographer_url  TEXT,
            download_location TEXT,
            scope             TEXT NOT NULL DEFAULT 'general',
            downloaded_at     TEXT NOT NULL,
            missing           INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_stock_photo_path ON stock_photos(rel_path);
    `)
}
