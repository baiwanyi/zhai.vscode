/**
 * 选区划线颜色反查：验证「块序号 + 原文」双命中的匹配口径，以及不确定时的回落。
 * 复用约定：直接构造 AnnotationRecord，不依赖编辑器实例或宿主协议；
 * 关键约束：块序号必须按 doc 原始顺序（含空文本块），原文必须逐字相等，失效记录跳过。
 */
import { describe, expect, it } from 'vitest'
import type { AnnotationRecord } from '@shared/types/editor'
import { findHighlightColor } from '@webview/editor/toolbar/selectionHighlight'

/** 造一条标注：默认是一条琥珀色划线，用例只覆写关心的字段 */
function createRecord(overrides: Partial<AnnotationRecord> = {}): AnnotationRecord {
    return {
        id: 'a1',
        docPath: 'notes/x.md',
        docTitle: 'x',
        kind: 'highlight',
        mode: 'inline',
        quote: '山不在高',
        prefix: '',
        suffix: '',
        startOffset: 0,
        endOffset: 4,
        blockId: '',
        blockIndex: 0,
        blockHash: 'h',
        blockText: '',
        color: 'amber',
        note: null,
        replies: '',
        orphaned: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
    }
}

describe('findHighlightColor', () => {
    it('同块同原文的划线命中并返回其颜色', () => {
        const items = [createRecord({ blockIndex: 2, quote: '山不在高', color: 'blue' })]
        expect(findHighlightColor(items, 2, '山不在高')).toBe('blue')
    })

    it('块序号不同不命中', () => {
        const items = [createRecord({ blockIndex: 2, color: 'blue' })]
        expect(findHighlightColor(items, 3, '山不在高')).toBeNull()
    })

    it('原文不同不命中（选区只选中一部分时不猜颜色）', () => {
        const items = [createRecord({ color: 'blue' })]
        expect(findHighlightColor(items, 0, '山不在')).toBeNull()
    })

    it('批注记录不参与匹配', () => {
        const items = [createRecord({ kind: 'note', note: '想法', color: null })]
        expect(findHighlightColor(items, 0, '山不在高')).toBeNull()
    })

    it('失效记录被跳过，回落到下一条命中的划线', () => {
        const items = [
            createRecord({ id: 'a1', color: 'blue', orphaned: true }),
            createRecord({ id: 'a2', color: 'emerald' }),
        ]
        expect(findHighlightColor(items, 0, '山不在高')).toBe('emerald')
    })

    it('块序号非法或原文为空直接返回 null', () => {
        const items = [createRecord({ blockIndex: -1 })]
        expect(findHighlightColor(items, -1, '山不在高')).toBeNull()
        expect(findHighlightColor(items, 0, '')).toBeNull()
    })
})
