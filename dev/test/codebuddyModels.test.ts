/**
 * codebuddyModels 单元测试：覆盖额度倍率（credits）解析与自定义模型判定。
 * 重点验证：平台下发格式并不统一（"x0.51 credits" / "x1.62"），两种都要取出数值；
 * "x0.00 credits" 是真实的零倍率，必须解析为 0 而不是未知；缺失或无数值时一律返回 null，
 * 避免把未知倍率误当成免费模型写进成本统计；自定义模型按 id 前缀、vendor、tags 三路识别，
 * 菜单分组的正确性依赖该判定。
 * 上下文档位部分重点验证：默认档位取 defaultLength → 最大支持档位 → maxInputTokens 的兜底顺序，
 * 可选档位去重升序且丢弃非法值，选择值不在可选范围内时必须回落 0（跟随模型默认），
 * 否则会把下游静默忽略的档位当成已生效。
 */
import { describe, expect, it } from 'vitest'
import {
    isCustomModel,
    parseCreditRate,
    pickContextWindow,
    readContextWindowOptions,
    readContextWindowTokens,
} from '../../src/modules/ai/providers/codebuddyModels'

describe('parseCreditRate', () => {
    it('带 credits 后缀的倍率取出数值', () => {
        expect(parseCreditRate('x0.29 credits')).toBe(0.29)
    })

    it('仅有倍率数字时同样取出数值', () => {
        expect(parseCreditRate('x1.62')).toBe(1.62)
    })

    it('零倍率解析为 0，不视作未知', () => {
        expect(parseCreditRate('x0.00 credits')).toBe(0)
    })

    it('小写 x 与大写 X 均可识别', () => {
        expect(parseCreditRate('X0.5 credits')).toBe(0.5)
    })

    it('缺失或无数值时返回 null', () => {
        expect(parseCreditRate(null)).toBeNull()
        expect(parseCreditRate(undefined)).toBeNull()
        expect(parseCreditRate('')).toBeNull()
        expect(parseCreditRate('credits')).toBeNull()
    })
})

describe('isCustomModel', () => {
    it('custom-local 前缀视为自定义模型', () => {
        expect(isCustomModel({ id: 'custom-local:deepseek-v4-flash123' })).toBe(true)
    })

    it('vendor 为 user 视为自定义模型', () => {
        expect(isCustomModel({ id: 'my-model', vendor: 'user' })).toBe(true)
    })

    it('tags 含 custom 视为自定义模型', () => {
        expect(isCustomModel({ id: 'my-model', tags: ['custom'] })).toBe(true)
    })

    it('平台内置模型返回 false', () => {
        expect(isCustomModel({ id: 'deepseek-v4-pro', vendor: 'f', tags: [] })).toBe(false)
    })
})

describe('pickContextWindow', () => {
    const options = [300_000, 600_000, 1_000_000]

    it('选中值在可选档位内时原样下发', () => {
        expect(pickContextWindow(600_000, options)).toBe(600_000)
    })

    it('选中值不在可选档位内时回落模型默认', () => {
        expect(pickContextWindow(400_000, options)).toBe(0)
    })

    it('0 与负数均表示跟随模型默认', () => {
        expect(pickContextWindow(0, options)).toBe(0)
        expect(pickContextWindow(-1, options)).toBe(0)
    })

    it('非有限数按未知处理', () => {
        expect(pickContextWindow(Number.NaN, options)).toBe(0)
        expect(pickContextWindow(Number.POSITIVE_INFINITY, options)).toBe(0)
    })

    it('可选档位为空时不下发任何档位', () => {
        expect(pickContextWindow(300_000, [])).toBe(0)
    })
})

describe('readContextWindowTokens', () => {
    it('优先取平台声明的默认档位', () => {
        const model = { id: 'm', contextWindow: { defaultLength: 300_000, supportedLengths: [300_000, 600_000] } }
        expect(readContextWindowTokens(model)).toBe(300_000)
    })

    it('未声明默认档位时取最大支持档位', () => {
        const model = { id: 'm', contextWindow: { supportedLengths: [300_000, 600_000] } }
        expect(readContextWindowTokens(model)).toBe(600_000)
    })

    it('两处都缺失时退回输入上限', () => {
        expect(readContextWindowTokens({ id: 'm', maxInputTokens: 128_000 })).toBe(128_000)
    })

    it('全部缺失时返回 0 表示未知', () => {
        expect(readContextWindowTokens({ id: 'm' })).toBe(0)
    })
})

describe('readContextWindowOptions', () => {
    it('去重并升序排列', () => {
        const model = { id: 'm', contextWindow: { supportedLengths: [600_000, 300_000, 600_000] } }
        expect(readContextWindowOptions(model)).toEqual([300_000, 600_000])
    })

    it('丢弃非正数与非有限值', () => {
        const model = { id: 'm', contextWindow: { supportedLengths: [0, -1, Number.NaN, 300_000] } }
        expect(readContextWindowOptions(model)).toEqual([300_000])
    })

    it('平台未下发时返回空数组', () => {
        expect(readContextWindowOptions({ id: 'm' })).toEqual([])
    })
})
