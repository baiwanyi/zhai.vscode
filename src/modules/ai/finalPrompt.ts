/**
 * 提示词拼装：合并词条原文与正文，并按固定顺序把上下文、约束、作品级补充与画风描述合成最终提示词。
 * 复用约定：词条归一化取 @shared/utils/promptTag 的 normalizePromptTag；各段文本、负向约束与画风描述
 * 全由调用方传入，本模块只做纯文本拼装，不读文件、不猜默认值；正文上限 MAX_PROMPT_LENGTH 也定义在此，
 * 出图与对话等入口共用同一份数值。
 * 关键约束：空串一律跳过，避免出现多余空行；顺序固定为 正文 → 上下文 → 规则 → 作品补充 → 负向 → 画风；
 * 词条合并只做「词条在前、正文在后」的逗号连接并按正文上限截断，各入口必须经 mergePromptTags，
 * 否则同一批词条在不同入口会拼出不同正文；负向约束统一加「避免出现：」前缀，便于模型识别为禁止项；
 * 调整顺序须同步 dev/test/imagegenPrompt.test.ts。
 */
import { normalizePromptTag } from '@shared/utils/promptTag'

/** 提示词正文长度上限：远超正常拼装结果，超出视为异常请求 */
export const MAX_PROMPT_LENGTH = 4000

/** 拼装入参：各段以数组传入，顺序即调用方的展示顺序 */
export interface PromptParts {
    /** 已并入词条与角色段的正文 */
    prompt: string
    /** 上下文段：作品设定等背景信息，接在正文之后 */
    contexts?: readonly string[]
    /** 规则段：读盘得到的约束，接在上下文之后 */
    rules?: readonly string[]
    /** 作品级补充：作品配置里的额外要求，接在规则之后 */
    suffix?: string
    /** 负向约束：非空时统一加「避免出现：」前缀 */
    negative?: string
    /** 画风描述：固定排在最后 */
    styleHint?: string
}

/**
 * 合并词条原文与正文：词条按芯片顺序前置，正文随后，逗号连接后按正文上限截断。
 * 出图与对话两侧共用本函数，保证交给模型的是同一份画面描述。
 */
export function mergePromptTags(tagTexts: readonly string[], prompt: string): string {
    return [...tagTexts.map((text) => normalizePromptTag(text)), prompt]
        .filter((part) => part.length > 0)
        .join(', ')
        .slice(0, MAX_PROMPT_LENGTH)
}

export function composePrompt({
    prompt,
    contexts = [],
    rules = [],
    suffix = '',
    negative = '',
    styleHint = '',
}: PromptParts): string {
    const parts = [prompt, ...contexts, ...rules, suffix]
    if (negative.length > 0) {
        parts.push(`避免出现：${negative}`)
    }
    parts.push(styleHint)
    return parts.filter((part) => part.length > 0).join('\n\n')
}
