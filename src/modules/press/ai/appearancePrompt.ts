/**
 * 人物外貌提示词：构造一次性生成的对话消息，把人物卡与作品氛围折算成一段白描指令。
 * 复用约定：消息结构复用 ../../ai/provider 的 AiChatMessage，多行字段折行取 ./plainText 的 toSingleLine；
 * 角色分类、性别、时代与题材由调用方转成中文字面量后再传入。
 * 关键约束：外貌标签是硬约束、已写外貌只补语气与细节，两者冲突时以标签为准；
 * 提示词不携带剧情走向与人物关系，避免外貌描写越界替作者决定故事；模型输出的清洗在服务层走 sanitizePlainText。
 */
import type { AiChatMessage as ChatMessage } from '@modules/ai/provider'
import type { CharacterAppearanceRequest } from '@shared/types/press'
import { toSingleLine } from './plainText'

/** 系统提示：限定篇幅、组织顺序、标签的硬约束与禁止项 */
const SYSTEM_PROMPT = `你是中文小说的人物外貌描写助手。只输出一段 150~260 字的白描正文，
按「整体轮廓 → 面部特征 → 衣着与随身物件 → 可见的气质细节」组织。
给了外貌标签时，每条标签都必须落成看得见的细节：可以并进同一句，但不能漏，也不能改写成相反的意思。
禁止输出 Markdown、标题、编号、列表、引号包裹；禁止写心理活动、台词与剧情；不要复述人物姓名。`

/** 构造人物外貌生成消息 */
export function buildAppearanceMessages(request: CharacterAppearanceRequest): ChatMessage[] {
    return [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(request) },
    ]
}

/** 用户提示：作品氛围 + 人物已填字段 + 硬约束 */
function buildUserPrompt(request: CharacterAppearanceRequest): string {
    const background = [...request.genres, request.era].filter((item) => item.length > 0).join('｜')
    const lines = [`作品背景：${background.length > 0 ? background : '未限定，按现代都市处理'}`]
    if (request.tone.length > 0) {
        lines.push(`文风基调：${request.tone}`)
    }
    // 性别与角色分类合并成一处括注：性别缺失（异常入参）时只保留分类，不写空值
    const roleLabel = request.gender.length > 0 ? `${request.role}·${request.gender}` : request.role
    lines.push(`人物：${request.name}（${roleLabel}）`)
    if (request.age.length > 0) {
        lines.push(`年龄：${request.age}`)
    }
    if (request.identity.length > 0) {
        lines.push(`身份：${request.identity}`)
    }
    // 标签是主设定：放在性格之前，提示模型先落实看得见的部分，再用性格解释它
    if (request.appearanceTags.length > 0) {
        lines.push(`外貌标签（逐条落实）：${request.appearanceTags.join('、')}`)
    }
    if (request.appearance.length > 0) {
        lines.push(`已写外貌（只作语气与细节补充，与标签冲突时以标签为准）：${toSingleLine(request.appearance)}`)
    }
    if (request.traits.length > 0) {
        lines.push(`性格：${request.traits.join('、')}`)
    }
    if (request.desire.length > 0) {
        lines.push(`核心欲望：${request.desire}`)
    }
    if (request.weakness.length > 0) {
        lines.push(`致命弱点：${request.weakness}`)
    }
    if (request.ability.length > 0) {
        lines.push(`能力：${request.ability}`)
    }
    lines.push(
        request.appearanceTags.length > 0
            ? '要求：标签是硬约束，全部写进正文并落到具体物件与动作上；已写外貌只补语气与细节，不得据此新增人设；不出现具体人名与地名。'
            : '要求：外貌细节要能呼应这个人的经历与性格；不出现具体人名与地名；只写看得见的东西。',
    )
    return lines.join('\n')
}
