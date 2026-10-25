/**
 * 出图提示词拼装的单测：覆盖作品级补充、负向约束与画风描述的叠加顺序，以及空串跳过。
 * 关注点：画风描述必须始终在最后一段；空串不产生多余空行；负向约束统一带「避免出现：」前缀。
 */
import { describe, expect, it } from 'vitest'
import type { ImageSettings } from '../src/shared/types/imagegen'
import { STYLE_HINTS } from '../src/modules/imagegen/ai/portraitPrompt'
import { composeImagePrompt } from '../src/modules/imagegen/promptCompose'
import { DEFAULT_IMAGE_SETTINGS } from '../src/shared/types/imagegen'

/** 以默认参数为底，便于逐项覆盖 */
function settingsWith(patch: Partial<ImageSettings>): ImageSettings {
    return { ...DEFAULT_IMAGE_SETTINGS, ...patch }
}

describe('出图提示词拼装', () => {
    it('无作品级补充时只拼正文与画风', () => {
        expect(composeImagePrompt('少女独立雨中', settingsWith({}), 'guofeng')).toBe(
            `少女独立雨中\n\n${STYLE_HINTS.guofeng}`,
        )
    })

    it('作品补充插在正文与画风之间', () => {
        const result = composeImagePrompt('少女独立雨中', settingsWith({ promptSuffix: '画面偏冷色调' }), 'anime')
        expect(result.split('\n\n')).toEqual(['少女独立雨中', '画面偏冷色调', STYLE_HINTS.anime])
    })

    it('负向约束加统一前缀，且排在画风之前', () => {
        const result = composeImagePrompt('少女独立雨中', settingsWith({ negative: '多余的手指、水印' }), 'realistic')
        expect(result).toContain('避免出现：多余的手指、水印')
        expect(result.endsWith(STYLE_HINTS.realistic)).toBe(true)
    })

    it('正文为空时只保留有内容的段，不产生连续空行', () => {
        const result = composeImagePrompt('', settingsWith({}), 'pixel')
        expect(result).toBe(STYLE_HINTS.pixel)
        expect(result.includes('\n\n\n')).toBe(false)
    })

    it('三项同时存在时顺序固定：正文 → 补充 → 负向 → 画风', () => {
        const result = composeImagePrompt('正文', settingsWith({ promptSuffix: '补充', negative: '水印' }), 'cinematic')
        expect(result.split('\n\n')).toEqual(['正文', '补充', '避免出现：水印', STYLE_HINTS.cinematic])
    })
})
