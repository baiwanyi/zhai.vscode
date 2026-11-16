/**
 * dashboardUtils 单元测试：覆盖字数紧凑展示与批量动作结果文案。
 * 纯函数测试，不依赖 DOM、宿主协议与 UI 库；断言集中在阈值分支与「无结果不产出文案」两处。
 */
import { describe, expect, it } from 'vitest'
import { formatBatchFailure, formatWordCount, readBatchOutcome } from '../src/dashboard/utils'

describe('formatWordCount', () => {
    it('不足一万原样输出', () => {
        expect(formatWordCount(0)).toBe('0')
        expect(formatWordCount(9999)).toBe('9999')
    })

    it('过万折算「万」并去掉多余小数', () => {
        expect(formatWordCount(10_000)).toBe('1 万')
        expect(formatWordCount(12_340)).toBe('1.2 万')
        expect(formatWordCount(1_500_000)).toBe('150 万')
    })
})

describe('formatBatchFailure', () => {
    it('只报条数与首条原因', () => {
        expect(formatBatchFailure('恢复', [{ message: '文件已被移除' }, { message: '第二个原因' }])).toBe(
            '2 项恢复失败：文件已被移除',
        )
    })

    it('原因为空时给出兜底文案', () => {
        expect(formatBatchFailure('清除', [])).toBe('0 项清除失败：未知原因')
    })
})

describe('readBatchOutcome', () => {
    it('成功与失败同时存在时各产出一条文案', () => {
        expect(
            readBatchOutcome({
                successText: (count) => `已恢复 ${String(count)} 篇笔记`,
                count: 2,
                failures: [{ message: '文件已被移除' }],
                failureAction: '恢复',
            }),
        ).toEqual({ success: '已恢复 2 篇笔记', failure: '1 项恢复失败：文件已被移除' })
    })

    it('没有成功项时不产出成功文案', () => {
        expect(
            readBatchOutcome({
                successText: (count) => `已恢复 ${String(count)} 篇笔记`,
                count: 0,
                failures: [{ message: '全部失败' }],
                failureAction: '恢复',
            }),
        ).toEqual({ success: null, failure: '1 项恢复失败：全部失败' })
    })

    it('没有失败项时不产出失败文案', () => {
        expect(
            readBatchOutcome({
                successText: (count) => `已彻底删除 ${String(count)} 项`,
                count: 3,
                failures: [],
                failureAction: '清除',
            }),
        ).toEqual({ success: '已彻底删除 3 项', failure: null })
    })
})
