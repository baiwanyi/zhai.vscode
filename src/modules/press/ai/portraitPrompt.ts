/**
 * 角色设定图提示词：把人物卡与作品氛围拼成图像模型可用的自然语言描述。
 * 复用约定：风格、构图与禁止项集中在此一份，不散落到服务层；尺寸与模型交给配置，提示词只管画什么。
 * 关键约束：外貌字段优先，缺失时退回身份与性格；不写入剧情与台词，避免模型画出叙事场景；
 * 提示词按服务商上限截断，超长时保留前段（人物特征在前，氛围在后）。
 */
import type { PortraitGenerateRequest, PortraitStyle } from '../../../shared/types/press'

/** 提示词长度上限：多数服务商限制 1000 字符以内，中文按 600 字控制 */
const MAX_PROMPT_LENGTH = 600

/** 画风描述：key 与 shared/types/press 的 PORTRAIT_STYLES 一一对应，新增风格须在此登记 */
const STYLE_HINTS: Readonly<Record<PortraitStyle, string>> = {
    realistic: '写实摄影风格，真实皮肤质感与自然光',
    guofeng: '东方工笔与水墨融合，淡雅配色与留白',
    anime: '日系动画赛璐璐上色，干净线条与明快配色',
    painterly: '数字厚涂，明显笔触与丰富色彩层次',
    cinematic: '电影级布光与调色，轮廓光与浅景深',
    lineart: '黑白线稿，排线塑形且不上色',
}

/** 构造图像生成提示词 */
export function buildPortraitPrompt(request: PortraitGenerateRequest): string {
    const background = [...request.genres, request.era].filter((item) => item.length > 0).join('、')
    const basics = [request.gender, request.age.length > 0 ? `${request.age} 岁` : '', request.identity]
        .filter((item) => item.length > 0)
        .join('，')
    const lines = [
        `${STYLE_HINTS[request.style]}的人物设定图，竖版构图，半身肖像，纯净单色背景，细节清晰。`,
        `角色：${request.name}（${request.role}）`,
    ]
    if (basics.length > 0) {
        lines.push(`基本信息：${basics}`)
    }
    if (request.appearance.length > 0) {
        lines.push(`外貌：${request.appearance}`)
    }
    if (request.traits.length > 0) {
        lines.push(`气质与性格：${request.traits.join('、')}`)
    }
    if (request.ability.length > 0) {
        lines.push(`能力或随身物件：${request.ability}`)
    }
    if (background.length > 0) {
        lines.push(`世界观：${background}`)
    }
    if (request.tone.length > 0) {
        lines.push(`整体氛围：${request.tone}`)
    }
    lines.push('要求：画面只出现一个人物，五官、发型与服饰符合设定，不要文字、水印、多人或分解图。')
    return lines.join('\n').slice(0, MAX_PROMPT_LENGTH)
}
