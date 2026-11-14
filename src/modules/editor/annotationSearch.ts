/**
 * 标注检索：总览页的分页、过滤、关键词与统计查询。
 * 复用约定：SQL 全部预编译，行到记录的转换复用 annotationRepository 的对外形态；
 * 关键词 ≥3 字走 annotations_fts（trigram），1–2 字走 LIKE——trigram 索引不到双字词，
 * 不兜底会让「搜角色名」直接返回空，用户会以为功能坏了。
 * 关键约束：分页用 keyset（created_at + id），不用 OFFSET；列表载荷不带 replies 等大字段；
 * total 只在首页算一次，翻页时传 null，避免每页都全量 COUNT。
 */
import type {
    AnnotationDocumentSummary,
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

/** 颜色枚举：与类型定义同序（字母序），统计结果按此顺序补齐零值，前端不必做缺省处理 */
const HIGHLIGHT_COLORS: readonly HighlightColor[] = ['amber', 'blue', 'coral', 'emerald', 'violet']

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

/** 颜色收窄：库里的脏值一律回落为 null，避免把非法色值喂给样式 */
function toColor(value: string | null): HighlightColor | null {
    return value !== null && (HIGHLIGHT_COLORS as readonly string[]).includes(value)
        ? (value as HighlightColor)
        : null
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
        color: toColor(row.color),
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

/**
 * 关键词 LIKE 兜底：trigram 索引不到 1–2 字词时改走全文 LIKE。
 * 必须带 ESCAPE：关键词里的 % 与 _ 否则会退化成通配符，「50%」能匹配出任意含 50 的行。
 */
const LIKE_KEYWORD_CLAUSE =
    " AND (a.quote LIKE ? ESCAPE '\\' OR a.block_text LIKE ? ESCAPE '\\' OR a.note LIKE ? ESCAPE '\\')"

/** LIKE 模式：两侧加通配符，内部的 \ % _ 先转义，配合上面的 ESCAPE 使用 */
function buildLikePattern(keyword: string): string {
    return `%${keyword.replace(/[\\%_]/gu, (char) => `\\${char}`)}%`
}

/**
 * 关键词过滤：≥3 字走 FTS 虚表 JOIN，1–2 字退回 LIKE，空关键词不加条件。
 * FROM 与条件必须成对给出——少了 JOIN 却带上 MATCH 会引用不存在的表。
 */
function buildKeywordFilter(keyword: string): { from: string; clause: string; params: unknown[] } {
    if (keyword.length >= FTS_MIN_CHARS) {
        return {
            from: 'FROM annotations a JOIN annotations_fts f ON f.rowid = a.rowid',
            clause: ' AND annotations_fts MATCH ?',
            params: [buildMatchQuery(keyword)],
        }
    }
    const from = 'FROM annotations a'
    if (keyword.length === 0) {
        return { from, clause: '', params: [] }
    }
    const pattern = buildLikePattern(keyword)
    return { from, clause: LIKE_KEYWORD_CLAUSE, params: [pattern, pattern, pattern] }
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
    const keywordFilter = buildKeywordFilter(query.keyword.trim())
    const filters = buildFilters(query)
    const cursorClause = query.cursor === null ? '' : ' AND (a.created_at < ? OR (a.created_at = ? AND a.id < ?))'
    const cursorParams = query.cursor === null ? [] : [query.cursor.createdAt, query.cursor.createdAt, query.cursor.id]
    const sql = `SELECT a.* ${keywordFilter.from} WHERE 1 = 1${filters.clause}${keywordFilter.clause}${cursorClause} ORDER BY a.created_at DESC, a.id DESC LIMIT ?`
    const rows = db
        .prepare(sql)
        .all(...filters.params, ...keywordFilter.params, ...cursorParams, limit + 1) as SearchRow[]
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
    const keywordFilter = buildKeywordFilter(query.keyword.trim())
    const filters = buildFilters(query)
    const row = db
        .prepare(`SELECT COUNT(*) AS total ${keywordFilter.from} WHERE 1 = 1${filters.clause}${keywordFilter.clause}`)
        .get(...filters.params, ...keywordFilter.params) as { total: number } | undefined
    return row?.total ?? 0
}

/** 统计：总数、类型、失效数与各颜色数量；byColor 补齐零值；查询数由路由层从查询表合并 */
export function statsAnnotations(db: Database.Database, docPath: string | null): Omit<AnnotationStats, 'queries'> {
    const clause = docPath === null ? '' : ' WHERE doc_path = ?'
    const params = docPath === null ? [] : [docPath]
    // 按颜色分组一次聚合：逐行拉回内存统计在标注上万条时既慢又占内存
    const rows = db
        .prepare(
            `SELECT color,
                    COUNT(*) AS total,
                    COALESCE(SUM(kind = 'note'), 0) AS notes,
                    COALESCE(SUM(orphaned), 0) AS orphaned
               FROM annotations${clause}
              GROUP BY color`,
        )
        .all(...params) as Array<{ color: string | null; total: number; notes: number; orphaned: number }>
    const stats: Omit<AnnotationStats, 'queries'> = {
        total: 0,
        highlights: 0,
        notes: 0,
        orphaned: 0,
        byColor: { amber: 0, blue: 0, coral: 0, emerald: 0, violet: 0 },
    }
    for (const row of rows) {
        stats.total += row.total
        stats.notes += row.notes
        stats.orphaned += row.orphaned
        const color = toColor(row.color)
        if (color !== null) {
            stats.byColor[color] += row.total
        }
    }
    stats.highlights = stats.total - stats.notes
    return stats
}

/**
 * 有标注的文档清单：按文档分组，取该文档最近一条记录的标题。
 * 关键约束：标题用「最近一条」而不是任意一条——文档改名后旧记录里还是旧标题，
 * 取最新的才与用户认知一致；同一文档的标题理论上一致，取最新只是兜底。
 */
export function listAnnotationDocuments(db: Database.Database): AnnotationDocumentSummary[] {
    const rows = db
        .prepare(
            `SELECT a.doc_path AS docPath,
                    (SELECT b.doc_title FROM annotations b
                      WHERE b.doc_path = a.doc_path
                      ORDER BY b.created_at DESC LIMIT 1) AS docTitle,
                    COUNT(*) AS itemCount
               FROM annotations a
              GROUP BY a.doc_path
              ORDER BY MAX(a.created_at) DESC`,
        )
        .all() as Array<{ docPath: string; docTitle: string | null; itemCount: number }>
    return rows.map((row) => ({
        docPath: row.docPath,
        docTitle: row.docTitle === null || row.docTitle === '' ? row.docPath : row.docTitle,
        count: row.itemCount,
    }))
}
