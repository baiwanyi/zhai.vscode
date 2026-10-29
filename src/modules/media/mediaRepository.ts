/**
 * 媒体仓储：media 主表与 media_usage 引用表的全部读写，供列举、详情、删除、扫描对账与迁移共用。
 * 复用约定：SQL 全部走 better-sqlite3 预编译语句，不做字符串拼接；批量写入包在事务里，
 * 行列命名由本文件统一映射为领域字段，调用方不接触 snake_case。
 * 关键约束：补录（scan）只更新 path / month / missing，不覆盖出处与出图参数——出处是历史事实；
 * 引用按 ref_path 整篇替换（先删后插），保证同一文档多次扫描不产生重复行；
 * 引用唯一键为 (media_id, ref_type, ref_path, ref_id)，同一文档内多次引用同一张图只留一行。
 */
import type {
    MediaKind,
    MediaMonthCount,
    MediaOrigin,
    MediaRefScope,
    MediaRefType,
    MediaScope,
    MediaUsageItem,
} from '@shared/types/media'
import type { PressLoreKind } from '@shared/types/press'
import type Database from 'better-sqlite3'

/** 主表行：字段名与 DDL 一致，仅在仓储内部使用 */
interface MediaRow {
    id: string
    path: string
    ext: string
    byte_size: number
    width: number | null
    height: number | null
    month: string
    created_at: string
    scope: string
    origin: string
    kind: string
    press_path: string | null
    press_name: string | null
    character_id: string | null
    character_name: string | null
    lore_kind: string | null
    lore_id: string | null
    lore_name: string | null
    prompt: string | null
    ratio: string | null
    style: string | null
    enhanced_from: string | null
    missing: number
    usage_count?: number
}

/** 引用行 */
interface UsageRow {
    ref_type: string
    ref_path: string
    ref_scope: string
    ref_id: string | null
    ref_title: string | null
    ref_anchor: string | null
    seen_at: string
}

/** 写入媒体的领域记录：出处列只在首次写入时生效 */
export interface MediaRecord {
    id: string
    path: string
    ext: string
    byteSize: number
    month: string
    createdAt: string
    scope: MediaScope
    origin: MediaOrigin
    kind: MediaKind
    pressPath: string | null
    pressName: string | null
    characterId: string | null
    characterName: string | null
    loreKind: PressLoreKind | null
    loreId: string | null
    loreName: string | null
    prompt: string | null
    ratio: string | null
    style: string | null
    enhancedFrom: string | null
}

/** 仓储读出的媒体：与协议条目的差别只在缺 url 与 usageCount 的拼装 */
export interface StoredMedia extends MediaRecord {
    missing: boolean
    usageCount: number
}

/** 待写入的引用 */
export interface UsageRecord {
    refType: MediaRefType
    refPath: string
    refScope: MediaRefScope
    refId: string | null
    refTitle: string | null
    refAnchor: string | null
}

/** 扫描对账用的磁盘条目：只含可直接落库的字段 */
export interface ScannedMedia {
    id: string
    path: string
    ext: string
    byteSize: number
    month: string
    createdAt: string
}

/** 行转领域对象：单点维护字段映射，避免各处手写 */
function toStoredMedia(row: MediaRow): StoredMedia {
    return {
        id: row.id,
        path: row.path,
        ext: row.ext,
        byteSize: row.byte_size,
        month: row.month,
        createdAt: row.created_at,
        scope: row.scope as MediaScope,
        origin: row.origin as MediaOrigin,
        kind: row.kind as MediaKind,
        pressPath: row.press_path,
        pressName: row.press_name,
        characterId: row.character_id,
        characterName: row.character_name,
        loreKind: (row.lore_kind as PressLoreKind | null) ?? null,
        loreId: row.lore_id,
        loreName: row.lore_name,
        prompt: row.prompt,
        ratio: row.ratio,
        style: row.style,
        enhancedFrom: row.enhanced_from,
        missing: row.missing === 1,
        usageCount: row.usage_count ?? 0,
    }
}

/** 引用行转领域对象 */
function toUsageItem(row: UsageRow): MediaUsageItem {
    return {
        refType: row.ref_type as MediaRefType,
        refPath: row.ref_path,
        refScope: row.ref_scope as MediaRefScope,
        refId: row.ref_id,
        refTitle: row.ref_title,
        refAnchor: row.ref_anchor,
        seenAt: row.seen_at,
    }
}

/** 主表 SELECT 的统一片段：补上引用计数，避免详情与列表各写一套聚合 */
const SELECT_MEDIA = `
    SELECT m.*, COALESCE(u.cnt, 0) AS usage_count
      FROM media m
      LEFT JOIN (SELECT media_id, COUNT(*) AS cnt FROM media_usage GROUP BY media_id) u ON u.media_id = m.id
`

/** 写入媒体：已存在时只纠正 path / month / missing，出处与出图参数保持首次写入的值 */
export function insertMedia(db: Database.Database, record: MediaRecord): void {
    db.prepare(
        `INSERT INTO media (
            id, path, ext, byte_size, month, created_at, scope, origin, kind,
            press_path, press_name, character_id, character_name, lore_kind, lore_id, lore_name,
            prompt, ratio, style, enhanced_from, missing
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(id) DO UPDATE SET
            path = excluded.path,
            month = excluded.month,
            missing = 0`,
    ).run(
        record.id,
        record.path,
        record.ext,
        record.byteSize,
        record.month,
        record.createdAt,
        record.scope,
        record.origin,
        record.kind,
        record.pressPath,
        record.pressName,
        record.characterId,
        record.characterName,
        record.loreKind,
        record.loreId,
        record.loreName,
        record.prompt,
        record.ratio,
        record.style,
        record.enhancedFrom,
    )
}

/** 按 id 读取单个媒体：不存在返回 null */
export function findMedia(db: Database.Database, id: string): StoredMedia | null {
    const row = db.prepare(`${SELECT_MEDIA} WHERE m.id = ?`).get(id) as MediaRow | undefined
    return row === undefined ? null : toStoredMedia(row)
}

/** 列举媒体：month 为空返回全部，按年月与时间倒序 */
export function listMedia(db: Database.Database, month: string | null): StoredMedia[] {
    const rows =
        month === null
            ? (db.prepare(`${SELECT_MEDIA} ORDER BY m.month DESC, m.created_at DESC, m.id DESC`).all() as MediaRow[])
            : (db
                  .prepare(`${SELECT_MEDIA} WHERE m.month = ? ORDER BY m.created_at DESC, m.id DESC`)
                  .all(month) as MediaRow[])
    return rows.map(toStoredMedia)
}

/** 年月聚合：包含 missing 条目，保证丢失的文件仍可见并可被清理 */
export function listMonths(db: Database.Database): MediaMonthCount[] {
    const rows = db.prepare('SELECT month, COUNT(*) AS count FROM media GROUP BY month ORDER BY month DESC').all() as {
        month: string
        count: number
    }[]
    return rows.map((row) => ({ month: row.month, count: row.count }))
}

/** 全库张数：与年月聚合同口径，含 missing */
export function countMedia(db: Database.Database): number {
    const row = db.prepare('SELECT COUNT(*) AS total FROM media').get() as { total: number }
    return row.total
}

/** 删除单条媒体：引用由调用方在同事务或之后清理 */
export function deleteMedia(db: Database.Database, id: string): void {
    db.prepare('DELETE FROM media WHERE id = ?').run(id)
}

/** 标记文件是否仍在磁盘：missing 只是展示标记，不删行，避免引用信息一起丢失 */
export function markMediaMissing(db: Database.Database, id: string, missing: boolean): void {
    db.prepare('UPDATE media SET missing = ? WHERE id = ?').run(missing ? 1 : 0, id)
}

/** 纠正路径与年月：文件被移动到别的年月目录时保持引用不断 */
export function updateMediaPath(db: Database.Database, id: string, mediaPath: string, month: string): void {
    db.prepare('UPDATE media SET path = ?, month = ?, missing = 0 WHERE id = ?').run(mediaPath, month, id)
}

/** 全部媒体的 id 与路径：扫描对账时与磁盘清单比对 */
export function listMediaPaths(db: Database.Database): { id: string; path: string }[] {
    return db.prepare('SELECT id, path FROM media').all() as { id: string; path: string }[]
}

/**
 * 取某个作品出处下的最新一张图：封面被删除时的回退目标。
 * 只按出处的 press_path 过滤，不把全库都算进来——「作品图库」在全局媒体库里靠这个字段界定。
 */
export function findLatestOfProject(
    db: Database.Database,
    pressPath: string,
    excludeId: string,
): { id: string; path: string } | null {
    const row = db
        .prepare(
            `SELECT id, path FROM media
              WHERE press_path = ? AND id != ? AND missing = 0
              ORDER BY created_at DESC, id DESC
              LIMIT 1`,
        )
        .get(pressPath, excludeId) as { id: string; path: string } | undefined
    return row ?? null
}

/** 按角色列举出处图：角色卡弹窗与封面回读使用，按时间降序（最新在前） */
export function listByCharacter(db: Database.Database, pressPath: string, characterId: string): StoredMedia[] {
    const rows = db
        .prepare(`${SELECT_MEDIA} WHERE m.press_path = ? AND m.character_id = ? ORDER BY m.created_at DESC, m.id DESC`)
        .all(pressPath, characterId) as MediaRow[]
    return rows.map(toStoredMedia)
}

/**
 * 按条目列举出处图：条目弹窗与封面回读使用。
 * loreKind 传 null 时只按标识过滤——老调用方不带分类，靠标识唯一性兜底。
 */
export function listByLore(
    db: Database.Database,
    pressPath: string,
    loreKind: string | null,
    loreId: string,
): StoredMedia[] {
    const rows =
        loreKind === null
            ? (db
                  .prepare(
                      `${SELECT_MEDIA}
                        WHERE m.press_path = ? AND m.lore_id = ?
                        ORDER BY m.created_at DESC, m.id DESC`,
                  )
                  .all(pressPath, loreId) as MediaRow[])
            : (db
                  .prepare(
                      `${SELECT_MEDIA}
                        WHERE m.press_path = ? AND m.lore_kind = ? AND m.lore_id = ?
                        ORDER BY m.created_at DESC, m.id DESC`,
                  )
                  .all(pressPath, loreKind, loreId) as MediaRow[])
    return rows.map(toStoredMedia)
}

/**
 * 作品封面候选：该作品出处下的非角色、非条目图，按时间降序截断。
 * 只看出处，不看目录——图片已全局化，作品图库靠 press_path 界定。
 */
export function listProjectPhotos(db: Database.Database, pressPath: string, limit: number): StoredMedia[] {
    const rows = db
        .prepare(
            `${SELECT_MEDIA}
              WHERE m.press_path = ? AND m.kind IN ('photo', 'unknown') AND m.missing = 0
              ORDER BY m.created_at DESC, m.id DESC
              LIMIT ?`,
        )
        .all(pressPath, limit) as MediaRow[]
    return rows.map(toStoredMedia)
}

/** 作品下的全部角色图：列表封面一次读回，避免为每张卡单独查询 */
export function listProjectPortraits(db: Database.Database, pressPath: string): StoredMedia[] {
    const rows = db
        .prepare(
            `${SELECT_MEDIA}
              WHERE m.press_path = ? AND m.kind = 'portrait' AND m.character_id IS NOT NULL
              ORDER BY m.created_at DESC, m.id DESC`,
        )
        .all(pressPath) as MediaRow[]
    return rows.map(toStoredMedia)
}

/** 作品下的全部条目图：同上，供条目列表批量显示封面 */
export function listProjectLoreImages(db: Database.Database, pressPath: string): StoredMedia[] {
    const rows = db
        .prepare(
            `${SELECT_MEDIA}
              WHERE m.press_path = ? AND m.kind = 'lore' AND m.lore_id IS NOT NULL
              ORDER BY m.created_at DESC, m.id DESC`,
        )
        .all(pressPath) as MediaRow[]
    return rows.map(toStoredMedia)
}

/** 作品封面候选总数：与截断后的列表分开返回，界面据此提示「仅显示最新 N 张」 */
export function countProjectPhotos(db: Database.Database, pressPath: string): number {
    const row = db
        .prepare(
            `SELECT COUNT(*) AS total FROM media
              WHERE press_path = ? AND kind IN ('photo', 'unknown') AND missing = 0`,
        )
        .get(pressPath) as { total: number }
    return row.total
}

/** 读取某张图的全部引用：按类型与时间倒序，供详情面板分组展示 */
export function listUsages(db: Database.Database, mediaId: string): MediaUsageItem[] {
    const rows = db
        .prepare('SELECT * FROM media_usage WHERE media_id = ? ORDER BY ref_type ASC, seen_at DESC')
        .all(mediaId) as UsageRow[]
    return rows.map(toUsageItem)
}

/** 写入一条引用：同键重复时刷新 seen_at，不产生第二行 */
export function insertUsage(db: Database.Database, mediaId: string, usage: UsageRecord): void {
    db.prepare(
        `INSERT INTO media_usage (media_id, ref_type, ref_path, ref_scope, ref_id, ref_title, ref_anchor, seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(media_id, ref_type, ref_path, ref_id) DO UPDATE SET
            ref_scope = excluded.ref_scope,
            ref_title = excluded.ref_title,
            ref_anchor = excluded.ref_anchor,
            seen_at = excluded.seen_at`,
    ).run(
        mediaId,
        usage.refType,
        usage.refPath,
        usage.refScope,
        usage.refId,
        usage.refTitle,
        usage.refAnchor,
        new Date().toISOString(),
    )
}

/** 清空某篇文档的全部引用：扫描时按文档整篇替换，避免逐条比对 */
function clearUsagesByRef(db: Database.Database, refPath: string): void {
    db.prepare('DELETE FROM media_usage WHERE ref_path = ?').run(refPath)
}

/** 清空某张图的全部引用：删除媒体时调用 */
export function clearUsagesByMedia(db: Database.Database, mediaId: string): void {
    db.prepare('DELETE FROM media_usage WHERE media_id = ?').run(mediaId)
}

/** 整篇文档的引用替换：先删后插，包在事务里，扫描中断不会留下半篇记录 */
export function replaceUsagesOfDocument(
    db: Database.Database,
    refPath: string,
    entries: readonly { mediaId: string; usage: UsageRecord }[],
): void {
    db.transaction(() => {
        clearUsagesByRef(db, refPath)
        for (const entry of entries) {
            insertUsage(db, entry.mediaId, entry.usage)
        }
    })()
}
