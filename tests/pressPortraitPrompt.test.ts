/**
 * 角色配图提示词测试：覆盖画面描述的清洗（前缀、引号、换行、超长）与两段式拼接（有描述 / 回退模板）。
 */
import { describe, expect, it } from 'vitest'
import type { PortraitGenerateRequest } from '../src/shared/types/press'
import { buildPortraitPrompt } from '../src/modules/press/ai/portraitPrompt'
import { sanitizeScene } from '../src/modules/press/ai/portraitScenePrompt'

function createRequest(overrides: Partial<PortraitGenerateRequest> = {}): PortraitGenerateRequest {
    return {
        dirPath: 'press/城南旧事',
        characterId: '12345678',
        name: '林岚',
        role: '主角',
        gender: '男',
        age: '27',
        height: '一米八五',
        bodyType: '健壮',
        identity: '边关校尉',
        appearance: '身形高大，左眉有旧疤',
        traits: ['沉着', '隐忍'],
        desire: '查清父亲死因',
        weakness: '不擅言辞',
        ability: '一手快刀',
        background: '军户出身，十六岁替父从军',
        relation: '与副将赵四有旧怨',
        era: '架空古代',
        genres: ['武侠'],
        tone: '冷峻',
        style: 'auto',
        ...overrides,
    }
}

describe('sanitizeScene', () => {
    it('去掉模型自带的「画面：」前缀', () => {
        expect(sanitizeScene('画面：雪夜破庙，提灯而立')).toBe('雪夜破庙，提灯而立')
    })

    it('去掉首尾引号并把换行压成一行', () => {
        expect(sanitizeScene('「雪夜\n破庙，提灯而立」')).toBe('雪夜 破庙，提灯而立')
    })

    it('超长描述截断到 120 字', () => {
        expect(sanitizeScene('长'.repeat(200))).toHaveLength(120)
    })
})

describe('buildPortraitPrompt', () => {
    it('有画面描述时插在插画基底与画风之间', () => {
        const prompt = buildPortraitPrompt(createRequest(), '雪夜破庙，提灯而立，暖光从侧面打来')
        expect(prompt).toContain('画面：雪夜破庙，提灯而立，暖光从侧面打来。')
        expect(prompt.indexOf('竖版小说配图')).toBeLessThan(prompt.indexOf('画面：'))
        expect(prompt.indexOf('画面：')).toBeLessThan(prompt.indexOf('画风：'))
    })

    it('缺省画面描述时回退纯字段模板', () => {
        const prompt = buildPortraitPrompt(createRequest())
        expect(prompt).not.toContain('画面：')
        expect(prompt).toContain('画风：')
        expect(prompt).toContain('角色：林岚（主角）')
    })

    it('提示词截断到 900 字以内且保留画面要求', () => {
        const prompt = buildPortraitPrompt(createRequest({ appearance: '长'.repeat(800) }), '长'.repeat(120))
        expect(prompt.length).toBeLessThanOrEqual(900)
        expect(prompt).toContain('要求：画面只出现一个人物')
    })

    it('基础信息含身高体型，并带上动机、背景与关系', () => {
        const prompt = buildPortraitPrompt(createRequest())
        expect(prompt).toContain('基本信息：男，27 岁，一米八五，健壮，边关校尉')
        expect(prompt).toContain('动机：查清父亲死因；不擅言辞')
        expect(prompt).toContain('背景：军户出身，十六岁替父从军')
        expect(prompt).toContain('人际关系：与副将赵四有旧怨')
    })
})
