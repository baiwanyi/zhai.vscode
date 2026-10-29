/**
 * 行级 diff 单元测试：验证变更块切分、行号、行尾归一与按段拼装。
 * 复用约定：只测纯函数，不读文件、不依赖宿主；实际写回版本校验由 chatService 用例覆盖。
 * 关键约束：等值行必须切断 hunk（否则无法逐段接受），未接受的段必须原样保留。
 */
import { describe, expect, it } from 'vitest'
import { composeAcceptedText, diffLines } from '../../src/shared/utils/diff'

describe('diffLines', () => {
    it('完全一致时没有变更块', () => {
        expect(diffLines('第一行\n第二行', '第一行\n第二行')).toEqual([])
        expect(diffLines('', '')).toEqual([])
    })

    it('等值行把变更切成两个独立的块', () => {
        const hunks = diffLines('A\nB\nC', 'A1\nB\nC1')
        expect(hunks).toHaveLength(2)
        expect(hunks[0]).toEqual({ oldStartLine: 1, oldText: ['A'], newStartLine: 1, newText: ['A1'] })
        expect(hunks[1]).toEqual({ oldStartLine: 3, oldText: ['C'], newStartLine: 3, newText: ['C1'] })
    })

    it('相邻的删除与新增合并为同一块，行号对齐原文', () => {
        const hunks = diffLines('A\nB\nC', 'A\nB1\nB2\nC')
        expect(hunks).toHaveLength(1)
        expect(hunks[0]?.oldText).toEqual(['B'])
        expect(hunks[0]?.newText).toEqual(['B1', 'B2'])
        expect(hunks[0]?.oldStartLine).toBe(2)
    })

    it('纯插入与纯删除只填一侧', () => {
        const inserted = diffLines('A\nC', 'A\nB\nC')
        expect(inserted).toEqual([{ oldStartLine: 2, oldText: [], newStartLine: 2, newText: ['B'] }])

        const removed = diffLines('A\nB\nC', 'A\nC')
        expect(removed).toEqual([{ oldStartLine: 2, oldText: ['B'], newStartLine: 2, newText: [] }])
    })

    it('CRLF 与 LF 的同一文本不产生变更', () => {
        expect(diffLines('第一行\r\n第二行', '第一行\n第二行')).toEqual([])
    })
})

describe('composeAcceptedText', () => {
    it('全部接受等于整段替换，全部拒绝等于原文', () => {
        const oldText = 'A\nB\nC'
        const newText = 'A1\nB\nC1'
        const hunks = diffLines(oldText, newText)
        expect(composeAcceptedText(oldText, hunks, [0, 1])).toBe(newText)
        expect(composeAcceptedText(oldText, hunks, [])).toBe(oldText)
    })

    it('只接受其中一段时，另一段保留原文', () => {
        const oldText = 'A\nB\nC'
        const hunks = diffLines(oldText, 'A1\nB\nC1')
        expect(composeAcceptedText(oldText, hunks, [1])).toBe('A\nB\nC1')
        expect(composeAcceptedText(oldText, hunks, [0])).toBe('A1\nB\nC')
    })

    it('越界索引被忽略，不影响其余段的拼装', () => {
        const oldText = 'A\nB\nC'
        const hunks = diffLines(oldText, 'A1\nB\nC1')
        expect(composeAcceptedText(oldText, hunks, [0, 9, -1])).toBe('A1\nB\nC')
    })
})
