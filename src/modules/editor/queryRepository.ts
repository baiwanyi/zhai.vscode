/**
 * 编辑区查询的缓存与历史：annotations.db 里的 editor_queries 表。
 * 复用约定：与 annotationRepository 同为手写 SQL，时间统一 ISO 字符串，主键用 randomUUID。
 * 关键约束：命中要求 doc_path + quote + question 三者完全一致且取最近一条；
 * 入库前 quote / question 必须与提示词同样 trim + 截断，否则「同一问题」永远命中不到自己写下的记录。
 */
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'

/** 与 queryService 的提示词上限保持一致：两处不一致会导致缓存永不命中 */
export const MAX_CACHED_QUOTE = 2000
export const MAX_CACHED_QUESTION = 500

export interface CachedQuery {
    id: string
    docPath: string
    quote: string
    question: string
    answer: string
    model: string
    createdAt: string
}

export interface QueryHistoryEntry {
    id: string
    quote: string
    question: string
    answer: string
    createdAt: string
}

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

/** 查缓存：同一文档、同一选区文本、同一问题，取最近一次回答 */
export function findCachedQuery(
    db: Database.Database,
    docPath: string,
    quote: string,
    question: string,
): CachedQuery | null {
    const key = normalize(quote, question)
    if (key.quote.length === 0) {
        return null
    }
    const row = db
        .prepare(
            `SELECT id, doc_path, quote, question, answer, model, created_at
               FROM editor_queries
              WHERE doc_path = ? AND quote = ? AND question = ?
              ORDER BY created_at DESC, rowid DESC
              LIMIT 1`,
        )
        .get(docPath, key.quote, key.question) as QueryRow | undefined
    return row === undefined ? null : toCachedQuery(row)
}

/** 写入一条历史：缓存与历史共用这张表，不额外建表 */
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
    db.prepare(
        `INSERT INTO editor_queries (id, doc_path, quote, question, answer, model, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(record.id, record.docPath, record.quote, record.question, record.answer, record.model, record.createdAt)
    return record
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
