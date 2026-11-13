/**
 * 查询缓存与历史：覆盖「命中 / 未命中 / 归一化后命中 / 跨文档复用 / 倒序列表」五条分支。
 * 关键约束：缓存键必须与提示词同口径（trim + 截断），否则用户看到的「同一个问题」永远命中不到；
 * 键里不含 doc_path——同一段文字在任何文档里查询都应复用同一条答案。
 */
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensureAnnotationSchema } from '@modules/editor/db/schema'
import {
    countQueries,
    findCachedQuery,
    listQueries,
    listRecentQueries,
    removeQueryById,
    saveQuery,
} from '@modules/editor/queryRepository'

const DOC_A = 'press/某作品/Chapters/01-第一章.md'
const DOC_B = 'notes/202611/随笔.md'

let db: Database.Database

beforeEach(() => {
    db = new Database(':memory:')
    ensureAnnotationSchema(db)
})

afterEach(() => {
    db.close()
})

describe('queryRepository', () => {
    it('写入后可命中，返回原始答案', () => {
        saveQuery(db, {
            docPath: DOC_A,
            quote: '他说这句话时',
            question: '有问题吗',
            answer: '有，偏口语',
            model: 'm1',
        })
        const cached = findCachedQuery(db, '他说这句话时', '有问题吗')
        expect(cached?.answer).toBe('有，偏口语')
    })

    it('两侧空白不影响命中（归一化一致）', () => {
        saveQuery(db, { docPath: DOC_A, quote: '  片段  ', question: ' 问 ', answer: '答案', model: 'm1' })
        expect(findCachedQuery(db, '片段', '问')?.answer).toBe('答案')
    })

    it('不同文档查询相同文本命中同一条（全局缓存）', () => {
        saveQuery(db, { docPath: DOC_A, quote: '同一句', question: '问', answer: 'A 的答案', model: 'm1' })
        const cached = findCachedQuery(db, '同一句', '问')
        expect(cached?.answer).toBe('A 的答案')
        // doc_path 只用于展示来源与跳转，命中后仍指向首次写入的文档
        expect(cached?.docPath).toBe(DOC_A)
    })

    it('问题不同不命中', () => {
        saveQuery(db, { docPath: DOC_A, quote: '同一句', question: '问一', answer: '答案', model: 'm1' })
        expect(findCachedQuery(db, '同一句', '问二')).toBeNull()
    })

    it('同一段同一问重复写入只留最新一条', () => {
        saveQuery(db, { docPath: DOC_A, quote: '片段', question: '问', answer: '旧答案', model: 'm1' })
        saveQuery(db, { docPath: DOC_A, quote: '片段', question: '问', answer: '新答案', model: 'm1' })
        expect(findCachedQuery(db, '片段', '问')?.answer).toBe('新答案')
        // 写入是「先删同键再插」，同一段文本不会在库里堆成多条
        const history = listRecentQueries(db, DOC_A)
        expect(history).toHaveLength(1)
        expect(history[0]?.answer).toBe('新答案')
    })

    it('空选区不查缓存，避免用空串误命中', () => {
        saveQuery(db, { docPath: DOC_A, quote: '', question: '问', answer: '答案', model: 'm1' })
        expect(findCachedQuery(db, '', '问')).toBeNull()
    })

    it('跨文档列表按时间倒序返回', () => {
        saveQuery(db, { docPath: DOC_A, quote: '第一段', question: '解释', answer: 'A 答案', model: 'm1' })
        saveQuery(db, { docPath: DOC_B, quote: '第二段', question: '解释', answer: 'B 答案', model: 'm1' })
        const items = listQueries(db, { keyword: '', limit: 50 })
        expect(items).toHaveLength(2)
        expect(items[0]?.docPath).toBe(DOC_B)
        expect(items[1]?.docPath).toBe(DOC_A)
    })

    it('关键词同时匹配原文、问题与答案', () => {
        saveQuery(db, { docPath: DOC_A, quote: '月光', question: '出处', answer: '李白', model: 'm1' })
        saveQuery(db, { docPath: DOC_B, quote: '风声', question: '典故', answer: '庄子', model: 'm1' })
        expect(listQueries(db, { keyword: '月光', limit: 50 })).toHaveLength(1)
        expect(listQueries(db, { keyword: '典故', limit: 50 })).toHaveLength(1)
        expect(listQueries(db, { keyword: '庄子', limit: 50 })).toHaveLength(1)
        expect(listQueries(db, { keyword: '不存在', limit: 50 })).toHaveLength(0)
    })

    it('计数与关键词过滤一致', () => {
        saveQuery(db, { docPath: DOC_A, quote: '甲', question: '解释', answer: '一', model: 'm1' })
        saveQuery(db, { docPath: DOC_A, quote: '乙', question: '解释', answer: '二', model: 'm1' })
        expect(countQueries(db, '')).toBe(2)
        expect(countQueries(db, '乙')).toBe(1)
        expect(countQueries(db, '不存在')).toBe(0)
    })

    it('删除后缓存不再命中', () => {
        const saved = saveQuery(db, {
            docPath: DOC_A,
            quote: '片段',
            question: '解释',
            answer: '答案',
            model: 'm1',
        })
        expect(findCachedQuery(db, '片段', '解释')?.answer).toBe('答案')
        expect(removeQueryById(db, saved.id)).toBe(true)
        expect(findCachedQuery(db, '片段', '解释')).toBeNull()
        expect(removeQueryById(db, saved.id)).toBe(false)
    })

    it('同一段文本重复写入只保留最新一条', () => {
        saveQuery(db, { docPath: DOC_A, quote: '饕餮', question: '解释', answer: '旧答案', model: 'm1' })
        saveQuery(db, { docPath: DOC_B, quote: '饕餮', question: '解释', answer: '新答案', model: 'm1' })
        const items = listQueries(db, { keyword: '', limit: 50 })
        expect(items).toHaveLength(1)
        expect(items[0]?.answer).toBe('新答案')
        expect(countQueries(db, '')).toBe(1)
    })

    it('历史库里的重复文本在列表里只出现一次', () => {
        // 直接插两行模拟改为全局缓存前留下的数据：saveQuery 已经不会再产生重复
        const insert = db.prepare(
            `INSERT INTO editor_queries (id, doc_path, quote, question, answer, model, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        insert.run('old-1', DOC_A, '饕餮', '解释', '旧答案', 'm1', '2026-01-01T00:00:00.000Z')
        insert.run('old-2', DOC_B, '饕餮', '解释', '新答案', 'm1', '2026-01-02T00:00:00.000Z')
        const items = listQueries(db, { keyword: '', limit: 50 })
        expect(items).toHaveLength(1)
        expect(items[0]?.answer).toBe('新答案')
        expect(countQueries(db, '')).toBe(1)
    })
})
