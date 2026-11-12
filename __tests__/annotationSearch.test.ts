/**
 * 标注检索：真实 SQLite（内存库）验证分页、过滤、关键词分流与统计。
 * 复用约定：直接调 annotationSearch 的纯查询函数，不经过 provider 与 webview。
 * 关键约束：两条关键词路径必须分别有断言——≥3 字走 FTS、1–2 字走 LIKE，
 * 这是总览页「搜不到两字词」缺陷的唯一防线。
 */
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { insertAnnotation } from '@modules/editor/annotationRepository'
import {
    countAnnotations,
    listAnnotationDocuments,
    listAnnotations,
    statsAnnotations,
} from '@modules/editor/annotationSearch'
import { ensureAnnotationSchema } from '@modules/editor/db/schema'
import type { AnnotationListQuery, AnnotationRecord, NewAnnotation } from '@shared/types/editor'

const DOC_A = 'press/某作品/Chapters/01-卷1/01-第一章.md'
const DOC_B = 'notes/2026-11/随笔.md'

let db: Database.Database

function newHighlight(overrides: Partial<NewAnnotation> = {}): NewAnnotation {
    return {
        docPath: DOC_A,
        docTitle: '第一章',
        kind: 'highlight',
        mode: 'inline',
        quote: '赵灵儿那是清纯的款的',
        prefix: '苏璃烟不像。',
        suffix: '，苏璃烟也不像。',
        startOffset: 128,
        endOffset: 140,
        blockId: 'blk-1',
        blockIndex: 3,
        blockHash: '3f9a1c2b',
        blockText: '苏璃烟不像。赵灵儿那是清纯的款的，苏璃烟也不像。',
        color: 'amber',
        note: null,
        replies: '[]',
        orphaned: false,
        ...overrides,
    }
}

/** 插入并指定创建时间：排序断言需要可控顺序 */
function insertAt(quote: string, createdAt: string, overrides: Partial<NewAnnotation> = {}): AnnotationRecord {
    const record = insertAnnotation(db, newHighlight({ quote, ...overrides }))
    db.prepare('UPDATE annotations SET created_at = ? WHERE id = ?').run(createdAt, record.id)
    return { ...record, createdAt }
}

function baseQuery(overrides: Partial<AnnotationListQuery> = {}): AnnotationListQuery {
    return {
        cursor: null,
        limit: 50,
        kind: null,
        color: null,
        docPath: null,
        orphanedOnly: false,
        keyword: '',
        ...overrides,
    }
}

beforeEach(() => {
    db = new Database(':memory:')
    ensureAnnotationSchema(db)
})

afterEach(() => {
    db.close()
})

describe('listAnnotations 分页', () => {
    it('按创建时间倒序返回，首页给出总数与游标', () => {
        insertAt('最早', '2026-11-01T00:00:00.000Z')
        insertAt('中间', '2026-11-05T00:00:00.000Z')
        insertAt('最新', '2026-11-09T00:00:00.000Z')
        const result = listAnnotations(db, baseQuery({ limit: 2 }))
        expect(result.items.map((item) => item.quote)).toEqual(['最新', '中间'])
        expect(result.nextCursor).not.toBeNull()
        expect(result.total).toBe(3)
    })

    it('游标翻页取到剩余项且不再返回 total', () => {
        insertAt('最早', '2026-11-01T00:00:00.000Z')
        insertAt('中间', '2026-11-05T00:00:00.000Z')
        insertAt('最新', '2026-11-09T00:00:00.000Z')
        const first = listAnnotations(db, baseQuery({ limit: 2 }))
        const second = listAnnotations(db, baseQuery({ limit: 2, cursor: first.nextCursor }))
        expect(second.items.map((item) => item.quote)).toEqual(['最早'])
        expect(second.nextCursor).toBeNull()
        expect(second.total).toBeNull()
    })

    it('limit 超过上限时按 200 截断', () => {
        insertAt('一条', '2026-11-01T00:00:00.000Z')
        const result = listAnnotations(db, baseQuery({ limit: 9999 }))
        expect(result.items).toHaveLength(1)
    })
})

describe('listAnnotations 过滤', () => {
    it('按类型、颜色、文档与失效状态过滤', () => {
        insertAt('划线一', '2026-11-01T00:00:00.000Z', { color: 'coral' })
        insertAt('划线二', '2026-11-02T00:00:00.000Z', { color: 'blue' })
        insertAt('批注一', '2026-11-03T00:00:00.000Z', { kind: 'note', color: null, note: '改写建议' })
        insertAt('别的文档', '2026-11-04T00:00:00.000Z', { docPath: DOC_B })
        insertAt('已失效', '2026-11-05T00:00:00.000Z', { orphaned: true })

        expect(listAnnotations(db, baseQuery({ kind: 'note' })).items).toHaveLength(1)
        expect(listAnnotations(db, baseQuery({ color: 'blue' })).items.map((item) => item.quote)).toEqual(['划线二'])
        expect(listAnnotations(db, baseQuery({ docPath: DOC_B })).items.map((item) => item.quote)).toEqual(['别的文档'])
        expect(listAnnotations(db, baseQuery({ orphanedOnly: true })).items.map((item) => item.quote)).toEqual([
            '已失效',
        ])
    })
})

describe('listAnnotations 关键词', () => {
    it('三字及以上走 FTS 命中划线文本', () => {
        insertAt('赵灵儿那是清纯的款的', '2026-11-01T00:00:00.000Z')
        insertAt('完全无关的内容', '2026-11-02T00:00:00.000Z', { blockText: '完全无关的段落' })
        const result = listAnnotations(db, baseQuery({ keyword: '赵灵儿那' }))
        expect(result.items.map((item) => item.quote)).toEqual(['赵灵儿那是清纯的款的'])
    })

    it('两字关键词走 LIKE 兜底', () => {
        insertAt('林凡出场', '2026-11-01T00:00:00.000Z', { blockText: '林凡出场时天色已暗' })
        insertAt('无关段落', '2026-11-02T00:00:00.000Z')
        const result = listAnnotations(db, baseQuery({ keyword: '林凡' }))
        expect(result.items.map((item) => item.quote)).toEqual(['林凡出场'])
    })

    it('关键词可命中段落快照与批注正文', () => {
        insertAt('划线文本', '2026-11-01T00:00:00.000Z', { blockText: '段落里有独特词甲' })
        insertAt('批注文本', '2026-11-02T00:00:00.000Z', { kind: 'note', color: null, note: '这里需要独特词乙' })
        expect(listAnnotations(db, baseQuery({ keyword: '独特词甲' })).items).toHaveLength(1)
        expect(listAnnotations(db, baseQuery({ keyword: '独特词乙' })).items).toHaveLength(1)
    })

    it('含引号的关键词不会破坏 FTS 语法', () => {
        insertAt('他说"走吧"就走了', '2026-11-01T00:00:00.000Z')
        expect(() => listAnnotations(db, baseQuery({ keyword: '他说"走' }))).not.toThrow()
    })

    it('countAnnotations 与列表使用同一组条件', () => {
        insertAt('赵灵儿那是清纯的款的', '2026-11-01T00:00:00.000Z')
        insertAt('另一条划线', '2026-11-02T00:00:00.000Z', { blockText: '另一段完全不同的文字' })
        expect(countAnnotations(db, baseQuery({ keyword: '赵灵儿那' }))).toBe(1)
        expect(countAnnotations(db, baseQuery())).toBe(2)
    })
})

describe('statsAnnotations', () => {
    it('按类型与颜色计数并补齐零值', () => {
        insertAt('划线一', '2026-11-01T00:00:00.000Z', { color: 'coral' })
        insertAt('划线二', '2026-11-02T00:00:00.000Z', { color: 'coral' })
        insertAt('批注一', '2026-11-03T00:00:00.000Z', { kind: 'note', color: null, note: '建议' })
        insertAt('已失效', '2026-11-04T00:00:00.000Z', { orphaned: true })
        const stats = statsAnnotations(db, null)
        expect(stats.total).toBe(4)
        expect(stats.highlights).toBe(3)
        expect(stats.notes).toBe(1)
        expect(stats.orphaned).toBe(1)
        expect(stats.byColor.coral).toBe(2)
        expect(stats.byColor.blue).toBe(0)
    })

    it('可按文档限定范围', () => {
        insertAt('A 文档', '2026-11-01T00:00:00.000Z')
        insertAt('B 文档', '2026-11-02T00:00:00.000Z', { docPath: DOC_B })
        expect(statsAnnotations(db, DOC_B).total).toBe(1)
    })
})

describe('listAnnotationDocuments', () => {
    it('按文档分组计数，并按最近一条的标题与时间排序', () => {
        insertAt('甲一', '2026-11-01T00:00:00.000Z', { docTitle: '第一章' })
        insertAt('甲二', '2026-11-02T00:00:00.000Z', { docTitle: '第一章' })
        insertAt('乙一', '2026-11-03T00:00:00.000Z', { docPath: DOC_B, docTitle: '随笔' })
        const documents = listAnnotationDocuments(db)
        expect(documents).toHaveLength(2)
        // 排序按最近一条记录：B 文档最新，排在前
        expect(documents[0]?.docPath).toBe(DOC_B)
        expect(documents[0]?.docTitle).toBe('随笔')
        expect(documents[0]?.count).toBe(1)
        expect(documents[1]?.count).toBe(2)
    })

    it('标题为空时回落到文档路径，不返回空串', () => {
        insertAt('无题', '2026-11-01T00:00:00.000Z', { docTitle: '' })
        const documents = listAnnotationDocuments(db)
        expect(documents[0]?.docTitle).toBe(DOC_A)
    })
})
