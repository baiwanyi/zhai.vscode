/**
 * 互动数展示：万级折算规则。
 * 重点锁住三档——不足一万原样、十万级以内保留一位小数、十万级以上取整；
 * 另外非有限数与 0 一律回 "0"，避免把异常数据渲染成 NaN。
 */
import { describe, expect, it } from 'vitest'
import { formatWeiboCount } from '../src/weibo/utils/weiboCount'

describe('formatWeiboCount', () => {
    it('不足一万原样显示', () => {
        expect(formatWeiboCount(0)).toBe('0')
        expect(formatWeiboCount(999)).toBe('999')
        expect(formatWeiboCount(9_999)).toBe('9999')
    })

    it('十万级以内保留一位小数，整数万不带 .0', () => {
        expect(formatWeiboCount(10_000)).toBe('1万')
        expect(formatWeiboCount(82_833)).toBe('8.3万')
        expect(formatWeiboCount(99_999)).toBe('10万')
    })

    it('十万级以上取整，非法输入回 0', () => {
        expect(formatWeiboCount(1_234_567)).toBe('123万')
        expect(formatWeiboCount(Number.NaN)).toBe('0')
        expect(formatWeiboCount(-1)).toBe('0')
    })
})
