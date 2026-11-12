/**
 * 标注仓储：用真实 SQLite（内存库）验证 CRUD、批量重定位、改名迁移与 FTS 触发器。
 * 复用约定：不 mock 数据库——事务、触发器和 trigram 分词只有在真实 SQLite 下才成立。
 * 关键约束：颜色白名单、orphaned 只置位、trigram 检索不到两字词，这三条都要有断言，
 * 它们分别对应样式安全、数据不丢与后续总览页必须实现 LIKE 兜底。
 */
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
    findAnnotation,
    insertAnnotation,
    listAnnotationsByDoc,
    markDocOrphaned,
    relocateAnnotations,
    removeAnnotation,
    renameAnnotationDoc,
    updateAnnotation,
} from '@modules/editor/annotationRepository'
import { ensureAnnotationSchema } from '@modules/editor/db/schema'
import type { NewAnnotation } from '@shared/types/editor'

const DOC_PATH = 'press/某作品/Chapters/01-卷1/01-第一章.md'
const NEXT_PATH = 'press/某作品/Chapters/01-卷1/02-第二章.md'

let db: Database.Database

function newHighlight(overrides: Partial<NewAnnotation> = {}): NewAnnotation {
    return {
        docPath: DOC_PATH,
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

beforeEach(() => {
    db = new Database(':memory:')
    ensureAnnotationSchema(db)
})

afterEach(() => {
    db.close()
})

describe('insertAnnotation / findAnnotation', () => {
    it('写入后可按 id 读回全部字段', () => {
        const created = insertAnnotation(db, newHighlight())
        const found = findAnnotation(db, created.id)
        expect(found).not.toBeNull()
        expect(found?.quote).toBe('赵灵儿那是清纯的款的')
        expect(found?.color).toBe('amber')
        expect(found?.blockId).toBe('blk-1')
        expect(found?.orphaned).toBe(false)
        expect(found?.createdAt).toBe(created.createdAt)
    })

    it('库里的非法颜色被收窄为 null', () => {
        const created = insertAnnotation(db, newHighlight())
        db.prepare('UPDATE annotations SET color = ? WHERE id = ?').run('rainbow', created.id)
        expect(findAnnotation(db, created.id)?.color).toBeNull()
    })

    it('未知 kind 回落为 highlight，未知 mode 回落为 inline', () => {
        const created = insertAnnotation(db, newHighlight())
        db.prepare('UPDATE annotations SET kind = ?, mode = ? WHERE id = ?').run('weird', 'weird', created.id)
        const found = findAnnotation(db, created.id)
        expect(found?.kind).toBe('highlight')
        expect(found?.mode).toBe('inline')
    })
})

describe('listAnnotationsByDoc', () => {
    it('按原文位置升序返回，且只含目标文档', () => {
        insertAnnotation(db, newHighlight({ startOffset: 200, quote: '后面' }))
        insertAnnotation(db, newHighlight({ startOffset: 10, quote: '前面' }))
        insertAnnotation(db, newHighlight({ docPath: 'notes/其它.md', quote: '别的文档' }))
        const list = listAnnotationsByDoc(db, DOC_PATH)
        expect(list).toHaveLength(2)
        expect(list[0]?.quote).toBe('前面')
        expect(list[1]?.quote).toBe('后面')
    })
})

describe('updateAnnotation / removeAnnotation', () => {
    it('局部更新只改传入字段', () => {
        const created = insertAnnotation(db, newHighlight())
        expect(updateAnnotation(db, created.id, { color: 'blue', note: '改色' })).toBe(true)
        const found = findAnnotation(db, created.id)
        expect(found?.color).toBe('blue')
        expect(found?.note).toBe('改色')
        expect(found?.quote).toBe(created.quote)
    })

    it('更新不存在的记录返回 false', () => {
        expect(updateAnnotation(db, 'missing', { color: 'blue' })).toBe(false)
    })

    it('删除返回是否真的删掉一行', () => {
        const created = insertAnnotation(db, newHighlight())
        expect(removeAnnotation(db, created.id)).toBe(true)
        expect(removeAnnotation(db, created.id)).toBe(false)
        expect(findAnnotation(db, created.id)).toBeNull()
    })
})

describe('relocateAnnotations', () => {
    it('批量回写锚点并保留未涉及字段', () => {
        const first = insertAnnotation(db, newHighlight())
        const second = insertAnnotation(db, newHighlight({ startOffset: 300, endOffset: 303, quote: '第二处' }))
        const updated = relocateAnnotations(db, DOC_PATH, [
            {
                id: first.id,
                startOffset: 140,
                endOffset: 152,
                blockIndex: 4,
                blockHash: 'aaaa1111',
                blockText: '新段落文本',
                orphaned: false,
            },
            {
                id: second.id,
                startOffset: 0,
                endOffset: 0,
                blockIndex: 0,
                blockHash: '',
                blockText: '',
                orphaned: true,
            },
        ])
        expect(updated).toBe(2)
        const relocated = findAnnotation(db, first.id)
        expect(relocated?.startOffset).toBe(140)
        expect(relocated?.blockHash).toBe('aaaa1111')
        expect(relocated?.color).toBe('amber')
        expect(findAnnotation(db, second.id)?.orphaned).toBe(true)
    })

    it('文档路径不匹配时不写入', () => {
        const created = insertAnnotation(db, newHighlight())
        const updated = relocateAnnotations(db, 'notes/其它.md', [
            {
                id: created.id,
                startOffset: 1,
                endOffset: 2,
                blockIndex: 0,
                blockHash: '',
                blockText: '',
                orphaned: false,
            },
        ])
        expect(updated).toBe(0)
        expect(findAnnotation(db, created.id)?.startOffset).toBe(128)
    })
})

describe('文档路径维护', () => {
    it('改名把标注整体迁到新路径', () => {
        insertAnnotation(db, newHighlight())
        expect(renameAnnotationDoc(db, DOC_PATH, NEXT_PATH)).toBe(1)
        expect(listAnnotationsByDoc(db, DOC_PATH)).toHaveLength(0)
        expect(listAnnotationsByDoc(db, NEXT_PATH)).toHaveLength(1)
    })

    it('文档删除只把未失效的标注置 orphaned', () => {
        insertAnnotation(db, newHighlight())
        insertAnnotation(db, newHighlight({ orphaned: true, quote: '已失效' }))
        expect(markDocOrphaned(db, DOC_PATH)).toBe(1)
        expect(listAnnotationsByDoc(db, DOC_PATH).every((item) => item.orphaned)).toBe(true)
    })
})

describe('annotations_fts 触发器', () => {
    it('插入后可被 trigram 检索到', () => {
        insertAnnotation(db, newHighlight())
        const rows = db
            .prepare('SELECT id FROM annotations_fts WHERE annotations_fts MATCH ?')
            .all('赵灵儿那') as Array<{ id: string }>
        expect(rows).toHaveLength(1)
    })

    it('更新后索引随之更新，旧关键词不再命中', () => {
        const created = insertAnnotation(db, newHighlight())
        // quote 与 block_text 同时替换：只改 quote 时旧词仍会被 block_text 命中，那是预期行为
        updateAnnotation(db, created.id, { quote: '完全不同的内容', blockText: '另一段内容' })
        const oldRows = db
            .prepare('SELECT id FROM annotations_fts WHERE annotations_fts MATCH ?')
            .all('赵灵儿那') as Array<{ id: string }>
        expect(oldRows).toHaveLength(0)
        const newRows = db
            .prepare('SELECT id FROM annotations_fts WHERE annotations_fts MATCH ?')
            .all('完全不同') as Array<{ id: string }>
        expect(newRows).toHaveLength(1)
    })

    it('删除后从索引中移除', () => {
        const created = insertAnnotation(db, newHighlight())
        removeAnnotation(db, created.id)
        const rows = db
            .prepare('SELECT id FROM annotations_fts WHERE annotations_fts MATCH ?')
            .all('赵灵儿那') as Array<{ id: string }>
        expect(rows).toHaveLength(0)
    })

    it('两字关键词无法命中 trigram 索引', () => {
        insertAnnotation(db, newHighlight({ quote: '林凡出场' }))
        const rows = db.prepare('SELECT id FROM annotations_fts WHERE annotations_fts MATCH ?').all('林凡') as Array<{
            id: string
        }>
        expect(rows).toHaveLength(0)
    })
})
