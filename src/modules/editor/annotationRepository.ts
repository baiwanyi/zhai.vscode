/**
 * 标注仓储：annotations 表的增删改查、批量锚点更新与文档路径维护。
 * 复用约定：SQL 全部预编译，id 与时间在本层生成，调用方只传业务字段；
 * 批量重定位与改名放进单个事务，避免长文里逐条提交带来的写盘放大。
 * 关键约束：行与记录的转换集中在此（snake_case ↔ camelCase、orphaned 0/1 ↔ boolean、颜色白名单）；
 * 删除只用于用户明确删除，重定位失败仅置 orphaned，不能顺手清掉用户批注。
 */
import { randomUUID } from 'node:crypto'
import type { AnnotationRecord, HighlightColor, NewAnnotation } from '@shared/types/editor'
import type Database from 'better-sqlite3'

/** 数据库行：列名与 schema 一一对应，仅在仓储内部使用 */
interface AnnotationRow {
    id: string
    doc_path: string
    doc_title: string
    kind: string
    mode: string
    quote: string
    prefix: string
    suffix: string
    start_offset: number
    end_offset: number
    block_id: string
    block_index: number
    block_hash: string
    block_text: string
    color: string | null
    note: string | null
    replies: string
    orphaned: number
    created_at: string
    updated_at: string
}

/** 颜色白名单：库里的脏值一律回落为 null，避免把非法色值喂给样式 */
const HIGHLIGHT_COLORS: readonly HighlightColor[] = ['coral', 'violet', 'blue', 'emerald', 'amber']

function toColor(value: string | null): HighlightColor | null {
    return value !== null && (HIGHLIGHT_COLORS as readonly string[]).includes(value) ? (value as HighlightColor) : null
}

/** 行转记录：类型字段按白名单收窄，未知取值按默认处理 */
function toRecord(row: AnnotationRow): AnnotationRecord {
    return {
        id: row.id,
        docPath: row.doc_path,
        docTitle: row.doc_title,
        kind: row.kind === 'note' ? 'note' : 'highlight',
        mode: row.mode === 'thread' ? 'thread' : 'inline',
        quote: row.quote,
        prefix: row.prefix,
        suffix: row.suffix,
        startOffset: row.start_offset,
        endOffset: row.end_offset,
        blockId: row.block_id,
        blockIndex: row.block_index,
        blockHash: row.block_hash,
        blockText: row.block_text,
        color: toColor(row.color),
        note: row.note,
        replies: row.replies,
        orphaned: row.orphaned === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    }
}

/** 插入一条标注：返回带 id 与时间的完整记录 */
export function insertAnnotation(db: Database.Database, input: NewAnnotation): AnnotationRecord {
    const now = new Date().toISOString()
    const record: AnnotationRecord = { ...input, id: randomUUID(), createdAt: now, updatedAt: now }
    db.prepare(
        `INSERT INTO annotations (
            id, doc_path, doc_title, kind, mode, quote, prefix, suffix,
            start_offset, end_offset, block_id, block_index, block_hash, block_text,
            color, note, replies, orphaned, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
        record.id,
        record.docPath,
        record.docTitle,
        record.kind,
        record.mode,
        record.quote,
        record.prefix,
        record.suffix,
        record.startOffset,
        record.endOffset,
        record.blockId,
        record.blockIndex,
        record.blockHash,
        record.blockText,
        record.color,
        record.note,
        record.replies,
        record.orphaned ? 1 : 0,
        record.createdAt,
        record.updatedAt,
    )
    return record
}

/** 读取单条：不存在返回 null */
export function findAnnotation(db: Database.Database, id: string): AnnotationRecord | null {
    const row = db.prepare('SELECT * FROM annotations WHERE id = ?').get(id) as AnnotationRow | undefined
    return row === undefined ? null : toRecord(row)
}

/** 读取某文档的全部标注：按原文位置升序，便于编辑器按序渲染 */
export function listAnnotationsByDoc(db: Database.Database, docPath: string): AnnotationRecord[] {
    const rows = db
        .prepare('SELECT * FROM annotations WHERE doc_path = ? ORDER BY start_offset ASC, created_at ASC')
        .all(docPath) as AnnotationRow[]
    return rows.map(toRecord)
}

/** 可更新的字段：均为业务字段，id 与 docPath 不在此列（改名走 renameAnnotationDoc） */
export type AnnotationPatch = Partial<
    Pick<
        AnnotationRecord,
        | 'docTitle'
        | 'quote'
        | 'prefix'
        | 'suffix'
        | 'startOffset'
        | 'endOffset'
        | 'blockId'
        | 'blockIndex'
        | 'blockHash'
        | 'blockText'
        | 'color'
        | 'note'
        | 'replies'
        | 'orphaned'
    >
>

/** 局部更新：先读后合并，再整行写回；记录不存在返回 false */
export function updateAnnotation(db: Database.Database, id: string, patch: AnnotationPatch): boolean {
    const current = findAnnotation(db, id)
    if (current === null) {
        return false
    }
    const next: AnnotationRecord = { ...current, ...patch, updatedAt: new Date().toISOString() }
    db.prepare(
        `UPDATE annotations SET
            doc_title = ?, quote = ?, prefix = ?, suffix = ?,
            start_offset = ?, end_offset = ?, block_id = ?, block_index = ?, block_hash = ?, block_text = ?,
            color = ?, note = ?, replies = ?, orphaned = ?, updated_at = ?
         WHERE id = ?`,
    ).run(
        next.docTitle,
        next.quote,
        next.prefix,
        next.suffix,
        next.startOffset,
        next.endOffset,
        next.blockId,
        next.blockIndex,
        next.blockHash,
        next.blockText,
        next.color,
        next.note,
        next.replies,
        next.orphaned ? 1 : 0,
        next.updatedAt,
        id,
    )
    return true
}

/** 物理删除：只用于用户明确删除 */
export function removeAnnotation(db: Database.Database, id: string): boolean {
    const result = db.prepare('DELETE FROM annotations WHERE id = ?').run(id)
    return result.changes > 0
}

/** 单条锚点更新：重定位结果批量回写时使用 */
export interface AnnotationRelocation {
    id: string
    startOffset: number
    endOffset: number
    blockIndex: number
    blockHash: string
    blockText: string
    orphaned: boolean
}

/** 批量回写锚点：整批一个事务，任一条不存在就跳过，不影响其余条目 */
export function relocateAnnotations(
    db: Database.Database,
    docPath: string,
    items: readonly AnnotationRelocation[],
): number {
    if (items.length === 0) {
        return 0
    }
    const now = new Date().toISOString()
    const statement = db.prepare(
        `UPDATE annotations SET
            start_offset = ?, end_offset = ?, block_index = ?, block_hash = ?, block_text = ?,
            orphaned = ?, updated_at = ?
         WHERE id = ? AND doc_path = ?`,
    )
    let updated = 0
    db.transaction(() => {
        for (const item of items) {
            const result = statement.run(
                item.startOffset,
                item.endOffset,
                item.blockIndex,
                item.blockHash,
                item.blockText,
                item.orphaned ? 1 : 0,
                now,
                item.id,
                docPath,
            )
            updated += result.changes
        }
    })()
    return updated
}

/** 文档改名：把该文档下的标注整体迁到新路径（一个人工操作对应一条 SQL） */
export function renameAnnotationDoc(db: Database.Database, fromPath: string, toPath: string): number {
    const result = db
        .prepare('UPDATE annotations SET doc_path = ?, updated_at = ? WHERE doc_path = ?')
        .run(toPath, new Date().toISOString(), fromPath)
    return result.changes
}

/** 文档被删除：置 orphaned 保留内容，供用户在总览页确认后再清理 */
export function markDocOrphaned(db: Database.Database, docPath: string): number {
    const result = db
        .prepare('UPDATE annotations SET orphaned = 1, updated_at = ? WHERE doc_path = ? AND orphaned = 0')
        .run(new Date().toISOString(), docPath)
    return result.changes
}
