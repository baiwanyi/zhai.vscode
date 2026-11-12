/**
 * 写回范围决策：纯函数，覆盖「选区命中 / 选区失效降级 / 空文档 / 超限」四条分支。
 * 关键约束：这几条是富文本写回的唯一防线——任何一条走错都会导致覆盖用户正文。
 */
import { describe, expect, it } from 'vitest'
import { decideWriteOffsets } from '@modules/ai/writeRangeOffsets'

const MAX = 100

describe('decideWriteOffsets', () => {
    it('选区能在原文中定位时取选区', () => {
        const text = '第一段\n\n第二段要改的文字\n\n第三段'
        const decision = decideWriteOffsets(text, '第二段要改的文字', MAX)
        expect(decision).not.toBeNull()
        expect(decision?.scope).toBe('selection')
        expect(decision?.isFallback).toBe(false)
        expect(text.slice(decision?.start, decision?.end)).toBe('第二段要改的文字')
    })

    it('选区定位不到时降级为整篇并标记 isFallback', () => {
        const text = '原文已经改过了'
        const decision = decideWriteOffsets(text, '早已不存在的句子', MAX)
        expect(decision?.scope).toBe('document')
        expect(decision?.isFallback).toBe(true)
        expect(decision?.start).toBe(0)
        expect(decision?.end).toBe(text.length)
    })

    it('无选区时取整篇且不算降级', () => {
        const text = '整篇正文'
        const decision = decideWriteOffsets(text, '', MAX)
        expect(decision?.scope).toBe('document')
        expect(decision?.isFallback).toBe(false)
        expect(decision?.end).toBe(text.length)
    })

    it('整篇为空时返回 null，避免写回空文档', () => {
        expect(decideWriteOffsets('', '', MAX)).toBeNull()
    })

    it('整篇超过上限时返回 null，要求用户选中片段', () => {
        expect(decideWriteOffsets('字'.repeat(MAX + 1), '', MAX)).toBeNull()
    })
})
