/**
 * 编辑区查询的缓存与历史：annotations.db 里的 editor_queries 表。
 * 复用约定：与 annotationRepository 同为手写 SQL，时间统一 ISO 字符串，主键用 randomUUID。
 * 关键约束：命中只要求 quote + question 一致（不按文档隔离）——同一段文字在任何文档里查询
 * 都不再触发第二次模型调用，因为解释的是文本本身，与它在哪篇文档里无关；
 * doc_path 照旧入库只作记录，界面不展示也不参与匹配；
 * 入库前 quote / question 必须与提示词同样 trim + 截断，否则「同一问题」永远命中不到自己写下的记录。
 */
import { randomUUID } from 'node:crypto'
import type { EditorQueryHistoryEntry, EditorQueryRecord } from '@shared/types/editor'
import type Database from 'better-sqlite3'

/** 与 queryService 的提示词上限保持一致：两处不一致会导致缓存永不命中 */
export const MAX_CACHED_QUOTE = 2000
export const MAX_CACHED_QUESTION = 500

/** 列表条数：与标注列表同档，防止前端一次把整张表拉走 */
const DEFAULT_LIST_LIMIT = 50
const MAX_LIST_LIMIT = 200

/** 缓存记录与标注页展示同形：直接复用共享类型，避免两份字段定义漂移 */
export type CachedQuery = EditorQueryRecord

export type QueryHistoryEntry = EditorQueryHistoryEntry

/** 归一化：与发送给模型的内容同口径，保证读写两侧键一致 */
function normalize(quote: string, question: string): { quote: string; question: string } {
    return {
        quote: quote.slice(0, MAX_CACHED_QUOTE).trim(),
        question: question.slice(0, MAX_CACHED_QUESTION).trim(),
    }
}

interface QueryRow {
    id: string
    doc_path: string
    quote: string
    question: string
    answer: string
    model: string
    created_at: string
}

function toCachedQuery(row: QueryRow): CachedQuery {
    return {
        id: row.id,
        docPath: row.doc_path,
        quote: row.quote,
        question: row.question,
        answer: row.answer,
        model: row.model,
        createdAt: row.created_at,
    }
}

/**
 * 查缓存：同一段文本 + 同一问题，取最近一次回答。
 * 关键约束：不按文档过滤——同一段文字在任何文档里查询都复用同一条答案，
 * 因此返回记录的 doc_path 可能是别的文档，调用方不要拿它当「当前文档」用。
 */
export function findCachedQuery(db: Database.Database, quote: string, question: string): CachedQuery | null {
    const key = normalize(quote, question)
    if (key.quote.length === 0) {
        return null
    }
    const row = db
        .prepare(
            `SELECT id, doc_path, quote, question, answer, model, created_at
               FROM editor_queries
              WHERE quote = ? AND question = ?
              ORDER BY created_at DESC, rowid DESC
              LIMIT 1`,
        )
        .get(key.quote, key.question) as QueryRow | undefined
    return row === undefined ? null : toCachedQuery(row)
}

/**
 * 写入一条结果：同一段文本只保留最新一条。
 * 命中缓存时本来就不会走到这里，这里的「先删后插」是并发双请求与旧数据的兜底——
 * 表里同文本只留一条，标注页不会出现同一段文字的多条解释。
 */
export function saveQuery(
    db: Database.Database,
    input: { docPath: string; quote: string; question: string; answer: string; model: string },
): CachedQuery {
    const key = normalize(input.quote, input.question)
    const record: CachedQuery = {
        id: randomUUID(),
        docPath: input.docPath,
        quote: key.quote,
        question: key.question,
        answer: input.answer,
        model: input.model,
        createdAt: new Date().toISOString(),
    }
    const write = db.transaction((): void => {
        db.prepare('DELETE FROM editor_queries WHERE quote = ? AND question = ?').run(key.quote, key.question)
        db.prepare(
            `INSERT INTO editor_queries (id, doc_path, quote, question, answer, model, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(record.id, record.docPath, record.quote, record.question, record.answer, record.model, record.createdAt)
    })
    write()
    return record
}

/** 关键词条件：quote / answer / question 三处都匹配，拼在 `WHERE rn = 1` 之后 */
function buildKeywordClause(keyword: string): { clause: string; params: string[] } {
    const trimmed = keyword.trim()
    if (trimmed.length === 0) {
        return { clause: '', params: [] }
    }
    const pattern = `%${trimmed}%`
    return { clause: ' AND (quote LIKE ? OR answer LIKE ? OR question LIKE ?)', params: [pattern, pattern, pattern] }
}

/**
 * 去重来源：同一段文本（quote + question）只保留最新一条。
 * 改为全局缓存前是按文档各存一份，历史库里同文本可能有多条，不去重会让列表出现重复条目。
 */
const QUERY_DEDUP_FROM = `(
        SELECT id, doc_path, quote, question, answer, model, created_at, rowid AS rid,
               ROW_NUMBER() OVER (PARTITION BY quote, question ORDER BY created_at DESC, rowid DESC) AS rn
          FROM editor_queries
      )`

/**
 * 跨文档列举 AI 解释记录：标注总览页的数据源。
 * 关键约束：只取下一页需要的条数，排序按时间倒序 + rowid 兜底（同一毫秒写入也能稳定分页）。
 */
export function listQueries(db: Database.Database, options: { keyword: string; limit: number }): EditorQueryRecord[] {
    const limit = Math.min(Math.max(Math.trunc(options.limit) || DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT)
    const { clause, params } = buildKeywordClause(options.keyword)
    const rows = db
        .prepare(
            `SELECT id, doc_path, quote, question, answer, model, created_at
               FROM ${QUERY_DEDUP_FROM}
              WHERE rn = 1${clause}
              ORDER BY created_at DESC, rid DESC
              LIMIT ?`,
        )
        .all(...params, limit) as QueryRow[]
    return rows.map(toCachedQuery)
}

/** 列表总数：与 listQueries 用同一段去重与过滤，标题上的条数不会与列表打架 */
export function countQueries(db: Database.Database, keyword: string): number {
    const { clause, params } = buildKeywordClause(keyword)
    const row = db.prepare(`SELECT COUNT(*) AS total FROM ${QUERY_DEDUP_FROM} WHERE rn = 1${clause}`).get(...params) as
        { total: number } | undefined
    return row?.total ?? 0
}

/** 删除一条：返回是否真的删掉，界面据此区分「已删」与「记录不在了」 */
export function removeQueryById(db: Database.Database, id: string): boolean {
    return db.prepare('DELETE FROM editor_queries WHERE id = ?').run(id).changes > 0
}

/** 最近查询：按文档倒序取若干条，供弹窗回看 */
export function listRecentQueries(db: Database.Database, docPath: string, limit = 8): QueryHistoryEntry[] {
    const rows = db
        .prepare(
            `SELECT id, quote, question, answer, created_at
               FROM editor_queries
              WHERE doc_path = ?
              ORDER BY created_at DESC, rowid DESC
              LIMIT ?`,
        )
        .all(docPath, limit) as Array<{
        id: string
        quote: string
        question: string
        answer: string
        created_at: string
    }>
    return rows.map((row) => ({
        id: row.id,
        quote: row.quote,
        question: row.question,
        answer: row.answer,
        createdAt: row.created_at,
    }))
}
