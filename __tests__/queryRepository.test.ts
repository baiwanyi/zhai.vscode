/**
 * 查询缓存与历史：覆盖「命中 / 未命中 / 归一化后命中 / 按文档隔离 / 倒序列表」五条分支。
 * 关键约束：缓存键必须与提示词同口径（trim + 截断），否则用户看到的「同一个问题」永远命中不到。
 */
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findCachedQuery, listRecentQueries, saveQuery } from '@modules/editor/queryRepository'
import { ensureAnnotationSchema } from '@modules/editor/db/schema'

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
        const cached = findCachedQuery(db, DOC_A, '他说这句话时', '有问题吗')
        expect(cached?.answer).toBe('有，偏口语')
    })

    it('两侧空白不影响命中（归一化一致）', () => {
        saveQuery(db, { docPath: DOC_A, quote: '  片段  ', question: ' 问 ', answer: '答案', model: 'm1' })
        expect(findCachedQuery(db, DOC_A, '片段', '问')?.answer).toBe('答案')
    })

    it('不同文档相同文本不串用', () => {
        saveQuery(db, { docPath: DOC_A, quote: '同一句', question: '问', answer: 'A 的答案', model: 'm1' })
        expect(findCachedQuery(db, DOC_B, '同一句', '问')).toBeNull()
    })

    it('问题不同不命中', () => {
        saveQuery(db, { docPath: DOC_A, quote: '同一句', question: '问一', answer: '答案', model: 'm1' })
        expect(findCachedQuery(db, DOC_A, '同一句', '问二')).toBeNull()
    })

    it('同一段同一问重复写入时取最新一条', () => {
        saveQuery(db, { docPath: DOC_A, quote: '片段', question: '问', answer: '旧答案', model: 'm1' })
        saveQuery(db, { docPath: DOC_A, quote: '片段', question: '问', answer: '新答案', model: 'm1' })
        expect(findCachedQuery(db, DOC_A, '片段', '问')?.answer).toBe('新答案')
        const history = listRecentQueries(db, DOC_A)
        expect(history).toHaveLength(2)
        expect(history[0]?.answer).toBe('新答案')
    })

    it('空选区不查缓存，避免用空串误命中', () => {
        saveQuery(db, { docPath: DOC_A, quote: '', question: '问', answer: '答案', model: 'm1' })
        expect(findCachedQuery(db, DOC_A, '', '问')).toBeNull()
    })
})
