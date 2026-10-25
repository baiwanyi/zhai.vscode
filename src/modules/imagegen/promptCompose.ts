/**
 * 出图提示词拼装：把前端正文、作品级补充、负向约束与画风描述合成最终提示词。
 * 复用约定：画风描述统一取 ./ai/portraitPrompt 的 STYLE_HINTS，作品级参数取 shared/types/imagegen 的
 * ImageSettings，此处不另设默认值，也不读文件。
 * 关键约束：空串一律跳过，避免出现多余空行；画风描述固定在最后，与既有出图口径保持一致；
 * 负向约束统一加「避免出现：」前缀，便于模型识别为禁止项而不是画面内容。
 */
import { STYLE_HINTS } from './ai/portraitPrompt'
import type { ImageSettings } from '../../shared/types/imagegen'
import type { PortraitStyle } from '../../shared/types/press'

export function composeImagePrompt(prompt: string, settings: ImageSettings, style: PortraitStyle): string {
    const parts = [prompt, settings.promptSuffix]
    if (settings.negative.length > 0) {
        parts.push(`避免出现：${settings.negative}`)
    }
    parts.push(STYLE_HINTS[style])
    return parts.filter((part) => part.length > 0).join('\n\n')
}
