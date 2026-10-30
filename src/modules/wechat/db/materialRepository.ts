/**
 * 素材映射仓储：wechat_materials 的读写，用于「本地图片 → 平台永久素材」的复用。
 * 复用约定：唯一键为 (account_id, local_hash, type)，同一张图在同一账号下只上传一次；
 * SQL 全部走预编译语句，行列命名由本文件统一映射，调用方不接触 snake_case。
 * 关键约束：url 与 media_id 都是平台侧事实，命中后直接复用、不再请求上传接口，
 * 因此本地文件即使被改动，只要 hash 不同就会生成新记录，不会出现「图换了但链接没变」。
 */
import type Database from 'better-sqlite3'

/** 素材行：字段名与 DDL 一致 */
export interface WechatMaterialRow {
    id: string
    account_id: string
    local_hash: string
    media_id: string
    url: string
    type: string
    name: string | null
    size_bytes: number
    created_at: string
}

/** 新建素材映射的落库字段 */
export interface WechatMaterialRecord {
    id: string
    accountId: string
    localHash: string
    mediaId: string
    url: string
    type: string
    name: string | null
    sizeBytes: number
    createdAt: string
}

/** 按账号 + 本地 hash + 类型查已上传素材，未命中返回 null */
export function findWechatMaterial(
    db: Database.Database,
    accountId: string,
    localHash: string,
    type: string,
): WechatMaterialRow | null {
    const row = db
        .prepare('SELECT * FROM wechat_materials WHERE account_id = ? AND local_hash = ? AND type = ?')
        .get(accountId, localHash, type)
    return row === undefined ? null : (row as WechatMaterialRow)
}

/** 列出某账号已上传的素材，按上传时间倒序 */
export function listWechatMaterials(db: Database.Database, accountId: string): WechatMaterialRow[] {
    return db
        .prepare('SELECT * FROM wechat_materials WHERE account_id = ? ORDER BY created_at DESC, id ASC')
        .all(accountId) as WechatMaterialRow[]
}

/** 写入素材映射：唯一键冲突说明并发上传了同一张图，调用方重新查询即可 */
export function insertWechatMaterial(db: Database.Database, record: WechatMaterialRecord): void {
    db.prepare(
        `INSERT INTO wechat_materials
            (id, account_id, local_hash, media_id, url, type, name, size_bytes, created_at)
         VALUES
            (@id, @accountId, @localHash, @mediaId, @url, @type, @name, @sizeBytes, @createdAt)`,
    ).run(record)
}
