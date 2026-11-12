/**
 * 标注检索：总览页的分页、过滤、关键词与统计查询。
 * 复用约定：SQL 全部预编译，行到记录的转换复用 annotationRepository 的对外形态；
 * 关键词 ≥3 字走 annotations_fts（trigram），1–2 字走 LIKE——trigram 索引不到双字词，
 * 不兜底会让「搜角色名」直接返回空，用户会以为功能坏了。
 * 关键约束：分页用 keyset（created_at + id），不用 OFFSET；列表载荷不带 replies 等大字段；
 * total 只在首页算一次，翻页时传 null，避免每页都全量 COUNT。
 */
import type {
    AnnotationListQuery,
    AnnotationListResult,
    AnnotationRecord,
    AnnotationStats,
    HighlightColor,
} from '@shared/types/editor'
import type Database from 'better-sqlite3'

/** 默认与上限：单页条数受控，防止前端一次拉全库 */
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

/** trigram 索引的最小查询长度：低于此值 MATCH 必然空 */
const FTS_MIN_CHARS = 3

/** 颜色枚举：统计结果按此顺序补齐零值，前端不必做缺省处理 */
const HIGHLIGHT_COLORS: readonly HighlightColor[] = ['coral', 'violet', 'blue', 'emerald', 'amber']

/** 行结构：与 annotations 表一致，仅本文件使用 */
interface SearchRow {
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

/** 行转记录：与仓储保持同一收窄口径 */
function toRecord(row: SearchRow): AnnotationRecord {
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
        color:
            row.color !== null && (HIGHLIGHT_COLORS as readonly string[]).includes(row.color)
                ? (row.color as HighlightColor)
                : null,
        note: row.note,
        replies: row.replies,
        orphaned: row.orphaned === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    }
}

/** 关键词转 FTS 短语查询：整体加引号并转义内部引号，避免被当成语法 */
function buildMatchQuery(keyword: string): string {
    return `"${keyword.replace(/"/gu, '""')}"`
}

/** 组装 WHERE 片段与参数：分页游标单独拼，避免参数顺序错乱 */
function buildFilters(query: AnnotationListQuery): { clause: string; params: unknown[] } {
    const conditions: string[] = []
    const params: unknown[] = []
    if (query.kind !== null) {
        conditions.push('a.kind = ?')
        params.push(query.kind)
    }
    if (query.color !== null) {
        conditions.push('a.color = ?')
        params.push(query.color)
    }
    if (query.docPath !== null) {
        conditions.push('a.doc_path = ?')
        params.push(query.docPath)
    }
    if (query.orphanedOnly) {
        conditions.push('a.orphaned = 1')
    }
    return {
        clause: conditions.length === 0 ? '' : ` AND ${conditions.join(' AND ')}`,
        params,
    }
}

/**
 * 查询一页标注：关键词分流决定 FROM 是否带 FTS 虚表。
 * @param query 过滤条件与游标
 */
export function listAnnotations(db: Database.Database, query: AnnotationListQuery): AnnotationListResult {
    const limit = Math.min(Math.max(Math.trunc(query.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT)
    const keyword = query.keyword.trim()
    const filters = buildFilters(query)
    const isFtsQuery = keyword.length >= FTS_MIN_CHARS
    const from = isFtsQuery ? 'FROM annotations a JOIN annotations_fts f ON f.rowid = a.rowid' : 'FROM annotations a'
    const keywordClause = isFtsQuery
        ? ' AND annotations_fts MATCH ?'
        : keyword.length === 0
          ? ''
          : ' AND (a.quote LIKE ? OR a.block_text LIKE ? OR a.note LIKE ?)'
    const keywordParams = isFtsQuery
        ? [buildMatchQuery(keyword)]
        : keyword.length === 0
          ? []
          : [`%${keyword}%`, `%${keyword}%`, `%${keyword}%`]
    const cursorClause = query.cursor === null ? '' : ' AND (a.created_at < ? OR (a.created_at = ? AND a.id < ?))'
    const cursorParams = query.cursor === null ? [] : [query.cursor.createdAt, query.cursor.createdAt, query.cursor.id]
    const sql = `SELECT a.* ${from} WHERE 1 = 1${filters.clause}${keywordClause}${cursorClause} ORDER BY a.created_at DESC, a.id DESC LIMIT ?`
    const rows = db.prepare(sql).all(...filters.params, ...keywordParams, ...cursorParams, limit + 1) as SearchRow[]
    const hasMore = rows.length > limit
    const pageRows = hasMore ? rows.slice(0, limit) : rows
    const items = pageRows.map(toRecord)
    const last = items[items.length - 1]
    return {
        items,
        nextCursor: hasMore && last !== undefined ? { createdAt: last.createdAt, id: last.id } : null,
        total: query.cursor === null ? countAnnotations(db, { ...query, cursor: null }) : null,
    }
}

/** 按同一组过滤条件计数：只有首页需要 */
export function countAnnotations(db: Database.Database, query: AnnotationListQuery): number {
    const keyword = query.keyword.trim()
    const filters = buildFilters(query)
    const isFtsQuery = keyword.length >= FTS_MIN_CHARS
    const from = isFtsQuery ? 'FROM annotations a JOIN annotations_fts f ON f.rowid = a.rowid' : 'FROM annotations a'
    const keywordClause = isFtsQuery
        ? ' AND annotations_fts MATCH ?'
        : keyword.length === 0
          ? ''
          : ' AND (a.quote LIKE ? OR a.block_text LIKE ? OR a.note LIKE ?)'
    const keywordParams = isFtsQuery
        ? [buildMatchQuery(keyword)]
        : keyword.length === 0
          ? []
          : [`%${keyword}%`, `%${keyword}%`, `%${keyword}%`]
    const row = db
        .prepare(`SELECT COUNT(*) AS total ${from} WHERE 1 = 1${filters.clause}${keywordClause}`)
        .get(...filters.params, ...keywordParams) as { total: number } | undefined
    return row?.total ?? 0
}

/** 统计：总数、类型、失效数与各颜色数量；byColor 补齐零值 */
export function statsAnnotations(db: Database.Database, docPath: string | null): AnnotationStats {
    const clause = docPath === null ? '' : ' WHERE doc_path = ?'
    const params = docPath === null ? [] : [docPath]
    const rows = db.prepare(`SELECT kind, color, orphaned FROM annotations${clause}`).all(...params) as Array<{
        kind: string
        color: string | null
        orphaned: number
    }>
    const stats: AnnotationStats = {
        total: rows.length,
        highlights: 0,
        notes: 0,
        orphaned: 0,
        byColor: { coral: 0, violet: 0, blue: 0, emerald: 0, amber: 0 },
    }
    for (const row of rows) {
        if (row.kind === 'note') {
            stats.notes += 1
        } else {
            stats.highlights += 1
        }
        if (row.orphaned === 1) {
            stats.orphaned += 1
        }
        if (row.color !== null && (HIGHLIGHT_COLORS as readonly string[]).includes(row.color)) {
            stats.byColor[row.color as HighlightColor] += 1
        }
    }
    return stats
}
