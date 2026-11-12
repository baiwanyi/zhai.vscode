/**
 * 锚点校正：覆盖「位置未变 / 前移后移 / 全文唯一命中 / 原文消失 / 多处命中」五条分支。
 * 关键约束：这几条决定标注会不会被挂到错误段落、或在原文改动后变成静默不显示的孤儿。
 */
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { relocateDocumentAnnotations } from '@modules/editor/annotationAnchors'
import { findAnnotation, insertAnnotation } from '@modules/editor/annotationRepository'
import { ensureAnnotationSchema } from '@modules/editor/db/schema'
import type { EditorBlock, NewAnnotation } from '@shared/types/editor'

const DOC = 'notes/202611/随笔.md'

let db: Database.Database

function newAnnotation(overrides: Partial<NewAnnotation> = {}): NewAnnotation {
    return {
        docPath: DOC,
        docTitle: '随笔',
        kind: 'highlight',
        mode: 'inline',
        quote: '第一段文字',
        prefix: '',
        suffix: '',
        startOffset: 0,
        endOffset: 5,
        blockId: 'blk-1',
        blockIndex: 0,
        blockHash: 'abc123',
        blockText: '第一段文字',
        color: 'coral',
        note: null,
        replies: '[]',
        orphaned: false,
        ...overrides,
    }
}

/** 三块结构：offset 按「上一块 end + 2」模拟段落间空行 */
function buildBlocks(texts: readonly string[]): EditorBlock[] {
    const blocks: EditorBlock[] = []
    let cursor = 0
    for (const text of texts) {
        const html = `<p>${text}</p>`
        blocks.push({ html, start: cursor, end: cursor + text.length })
        cursor += text.length + 2
    }
    return blocks
}

beforeEach(() => {
    db = new Database(':memory:')
    ensureAnnotationSchema(db)
})

afterEach(() => {
    db.close()
})

describe('relocateDocumentAnnotations', () => {
    it('位置未变时不产生写入', () => {
        const created = insertAnnotation(db, newAnnotation())
        const updated = relocateDocumentAnnotations(db, DOC, buildBlocks(['第一段文字', '第二段']))
        expect(updated).toBe(0)
        expect(findAnnotation(db, created.id)?.orphaned).toBe(false)
    })

    it('块前插入新段后，标注迁移到新块号与偏移', () => {
        const created = insertAnnotation(db, newAnnotation())
        const blocks = buildBlocks(['新插入的一段', '第一段文字', '第二段'])
        const updated = relocateDocumentAnnotations(db, DOC, blocks)
        expect(updated).toBe(1)
        const record = findAnnotation(db, created.id)
        expect(record?.blockIndex).toBe(1)
        expect(record?.startOffset).toBe(blocks[1]?.start)
        expect(record?.orphaned).toBe(false)
    })

    it('原块号失效但全文唯一命中时也能找回', () => {
        const created = insertAnnotation(db, newAnnotation({ blockIndex: 9, startOffset: 999 }))
        const blocks = buildBlocks(['前置说明', '第二段文字', '第一段文字'])
        const updated = relocateDocumentAnnotations(db, DOC, blocks)
        expect(updated).toBe(1)
        expect(findAnnotation(db, created.id)?.blockIndex).toBe(2)
    })

    it('原文彻底消失时置为失效，但不删除记录', () => {
        const created = insertAnnotation(db, newAnnotation())
        const updated = relocateDocumentAnnotations(db, DOC, buildBlocks(['完全换掉的内容', '另一段']))
        expect(updated).toBe(1)
        const record = findAnnotation(db, created.id)
        expect(record).not.toBeNull()
        expect(record?.orphaned).toBe(true)
    })

    it('多处命中时不猜位置，按失效处理', () => {
        const created = insertAnnotation(db, newAnnotation({ quote: '文字', blockIndex: 9 }))
        const blocks = buildBlocks(['这段有文字', '那段也有文字'])
        const updated = relocateDocumentAnnotations(db, DOC, blocks)
        expect(updated).toBe(1)
        expect(findAnnotation(db, created.id)?.orphaned).toBe(true)
    })
})
