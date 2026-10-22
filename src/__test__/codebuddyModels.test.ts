/**
 * codebuddyModels 单元测试：覆盖额度倍率（credits）解析与自定义模型判定。
 * 重点验证：平台下发格式并不统一（"x0.51 credits" / "x1.62"），两种都要取出数值；
 * "x0.00 credits" 是真实的零倍率，必须解析为 0 而不是未知；缺失或无数值时一律返回 null，
 * 避免把未知倍率误当成免费模型写进成本统计；自定义模型按 id 前缀、vendor、tags 三路识别，
 * 菜单分组的正确性依赖该判定。
 */
import { describe, expect, it } from 'vitest'
import { isCustomModel, parseCreditRate } from '../modules/ai/providers/codebuddyModels'

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
