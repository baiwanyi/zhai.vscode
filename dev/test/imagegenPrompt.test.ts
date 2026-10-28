/**
 * 提示词拼装的单测：覆盖上下文、规则、作品级补充、负向约束与画风描述的叠加顺序，以及空串跳过。
 * 关注点：拼装与词条合并已上移到 ai/finalPrompt，出图与对话共用同一份实现；
 * 画风描述必须始终在最后一段；空串不产生多余空行；负向约束统一带「避免出现：」前缀；
 * 上下文与规则都排在正文之后、作品补充之前；
 * 词条原文的归一化口径由前端与宿主共用，颜文字标签不能被误当作权重剥掉；
 * 词条与正文的合并同时服务出图与提示词增强，空段不留下多余分隔符；
 * 出图指令模板必须内嵌完整提示词与尺寸，并在有参考图时写明张数。
 */
import { describe, expect, it } from 'vitest'
import { normalizePromptTag } from '@shared/utils/promptTag'
import { composePrompt, MAX_PROMPT_LENGTH, mergePromptTags } from '../../src/modules/ai/finalPrompt'
import { buildImageInstruction, STYLE_HINTS } from '../../src/modules/imagegen/prompt'

describe('提示词拼装', () => {
    it('无上下文与作品级补充时只拼正文与画风', () => {
        expect(composePrompt({ prompt: '少女独立雨中', styleHint: STYLE_HINTS.guofeng })).toBe(
            `少女独立雨中\n\n${STYLE_HINTS.guofeng}`,
        )
    })

    it('上下文紧接正文之后、作品补充之前', () => {
        const result = composePrompt({
            prompt: '少女独立雨中',
            contexts: ['书名：剑来'],
            suffix: '画面偏冷色调',
            styleHint: STYLE_HINTS.anime,
        })
        expect(result.split('\n\n')).toEqual(['少女独立雨中', '书名：剑来', '画面偏冷色调', STYLE_HINTS.anime])
    })

    it('负向约束加统一前缀，且排在画风之前', () => {
        const result = composePrompt({
            prompt: '少女独立雨中',
            negative: '多余的手指、水印',
            styleHint: STYLE_HINTS.realistic,
        })
        expect(result).toContain('避免出现：多余的手指、水印')
        expect(result.endsWith(STYLE_HINTS.realistic)).toBe(true)
    })

    it('正文为空时只保留有内容的段，不产生连续空行', () => {
        const result = composePrompt({ prompt: '', styleHint: STYLE_HINTS.pixel })
        expect(result).toBe(STYLE_HINTS.pixel)
        expect(result.includes('\n\n\n')).toBe(false)
    })

    it('五项同时存在时顺序固定：正文 → 上下文 → 规则 → 补充 → 负向 → 画风', () => {
        const result = composePrompt({
            prompt: '正文',
            contexts: ['书名：剑来'],
            rules: ['规则'],
            suffix: '补充',
            negative: '水印',
            styleHint: STYLE_HINTS.cinematic,
        })
        expect(result.split('\n\n')).toEqual([
            '正文',
            '书名：剑来',
            '规则',
            '补充',
            '避免出现：水印',
            STYLE_HINTS.cinematic,
        ])
    })

    it('上下文与规则中的空串不占位', () => {
        const result = composePrompt({
            prompt: '正文',
            contexts: ['', '书名：剑来'],
            rules: ['规则一', '', '规则二'],
            styleHint: STYLE_HINTS.cinematic,
        })
        expect(result.split('\n\n')).toEqual(['正文', '书名：剑来', '规则一', '规则二', STYLE_HINTS.cinematic])
    })
})

describe('词条与正文合并', () => {
    it('词条按芯片顺序前置，正文随后，逗号连接', () => {
        expect(mergePromptTags(['female, long hair', 'smile'], '站在雨中')).toBe('female, long hair, smile, 站在雨中')
    })

    it('词条原文先做权重归一化再拼接', () => {
        expect(mergePromptTags(['(female:1.3)'], '')).toBe('female')
    })

    it('空词条与空正文不留下多余分隔符', () => {
        expect(mergePromptTags(['', '  '], '正文')).toBe('正文')
        expect(mergePromptTags([], '正文')).toBe('正文')
        expect(mergePromptTags(['词条'], '')).toBe('词条')
    })

    it('合并结果按正文上限截断', () => {
        expect(mergePromptTags(['x'.repeat(MAX_PROMPT_LENGTH)], '正文')).toHaveLength(MAX_PROMPT_LENGTH)
    })
})

describe('词条原文归一化', () => {
    it('剥离权重与强调括号，按逗号重新连接', () => {
        expect(normalizePromptTag('(female:1.3), [long hair], smile')).toBe('female, long hair, smile')
    })

    it('颜文字标签的冒号不被当作权重', () => {
        expect(normalizePromptTag(':3')).toBe(':3')
    })

    it('空段与纯空白段被丢弃', () => {
        expect(normalizePromptTag(' female , , () ')).toBe('female')
    })

    it('词内消歧括号不被当作强调剥掉', () => {
        expect(normalizePromptTag('ballpoint_pen_(medium)')).toBe('ballpoint_pen_(medium)')
        expect(normalizePromptTag('star_(sky), heart_lock_(kantai_collection)')).toBe(
            'star_(sky), heart_lock_(kantai_collection)',
        )
    })

    it('括号内带逗号的整段先剥括号再分段', () => {
        expect(normalizePromptTag('((the best quality, super fine illustrations))')).toBe(
            'the best quality, super fine illustrations',
        )
    })

    it('并列的独立括号逐段剥离', () => {
        expect(normalizePromptTag('(a), (b)')).toBe('a, b')
    })
})

describe('出图指令模板', () => {
    it('内嵌完整提示词与尺寸，并要求立即调用出图工具', () => {
        const instruction = buildImageInstruction({ prompt: '正文', size: '768x1024', referenceCount: 0 })
        expect(instruction).toContain('画面要求：正文')
        expect(instruction).toContain('尺寸：768x1024')
        expect(instruction).toContain('请立即调用 ImageGen 工具生成一张图片')
    })

    it('无参考图时不出现参考图片说明，有参考图时写明张数', () => {
        const plain = buildImageInstruction({ prompt: '正文', size: '768x1024', referenceCount: 0 })
        const withRefs = buildImageInstruction({ prompt: '正文', size: '768x1024', referenceCount: 2 })
        expect(plain).not.toContain('参考图片')
        expect(withRefs).toContain('随附 2 张参考图片')
    })
})
