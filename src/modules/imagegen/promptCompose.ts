/**
 * 出图提示词拼装：把前端正文、上下文、规则约束、作品级补充、负向约束与画风描述合成最终提示词。
 * 复用约定：画风描述统一取 ./ai/portraitPrompt 的 STYLE_HINTS，作品级参数取 shared/types/imagegen 的
 * ImageSettings，规则正文由 ./promptRuleService 读盘后传入，此处不另设默认值，也不读文件。
 * 关键约束：空串一律跳过，避免出现多余空行；顺序固定为 正文 → 上下文 → 规则 → 作品补充 → 负向 → 画风，
 * 上下文与规则都来自「添加上下文」菜单，作为背景与约束而非画面描述；
 * 画风描述固定在最后，与既有出图口径保持一致；负向约束统一加「避免出现：」前缀，
 * 便于模型识别为禁止项而不是画面内容。
 */
import type { ImageSettings } from '@shared/types/imagegen'
import type { PortraitStyle } from '@shared/types/press'
import { STYLE_HINTS } from './ai/portraitPrompt'

/** 拼装入参：contexts 与 rules 都以段为单位，顺序即前端芯片顺序 */
export interface ImagePromptParts {
    /** 已并入词条与角色段的正文 */
    prompt: string
    /** 上下文段：「添加上下文」菜单添加的设定等，接在正文之后 */
    contexts?: readonly string[]
    /** 规则段：读盘得到的约束，接在上下文之后 */
    rules?: readonly string[]
    settings: ImageSettings
    style: PortraitStyle
}

export function composeImagePrompt({ prompt, contexts = [], rules = [], settings, style }: ImagePromptParts): string {
    const parts = [prompt, ...contexts, ...rules, settings.promptSuffix]
    if (settings.negative.length > 0) {
        parts.push(`避免出现：${settings.negative}`)
    }
    parts.push(STYLE_HINTS[style])
    return parts.filter((part) => part.length > 0).join('\n\n')
}
