/**
 * 人物外貌提示词与结果清洗：构造一次性生成的对话消息，并把模型输出收敛为单段白描正文。
 * 复用约定：消息结构复用 ../../ai/provider 的 AiChatMessage；定位、时代与题材由调用方转成中文字面量后再传入。
 * 关键约束：模型输出一律视为不可信——去掉代码围栏、标题符号、列表符号与首尾引号，压缩空行并截断超长内容；
 * 提示词不携带剧情走向与人物关系，避免外貌描写越界替作者决定故事。
 */
import type { CharacterAppearanceRequest } from '../../../shared/types/press'
import type { AiChatMessage as ChatMessage } from '../../ai/provider'

/** 系统提示：限定篇幅、组织顺序与禁止项 */
const SYSTEM_PROMPT = `你是中文小说的人物外貌描写助手。只输出一段 120~200 字的白描正文，
按「整体轮廓 → 面部特征 → 衣着与随身物件 → 可见的气质细节」组织。
禁止输出 Markdown、标题、编号、列表、引号包裹；禁止写心理活动、台词与剧情；不要复述人物姓名。`

/** 输出长度上限：超出时截断，避免模型把小传写成小作文 */
const MAX_CONTENT_LENGTH = 600
/** 列表符号与编号前缀 */
const BULLET_PATTERN = /^[-*•]\s+/
const NUMBERING_PATTERN = /^\d+[.、)]\s*/
/** 首尾可能出现的引号与书名号 */
const WRAPPING_PATTERN = /^[「『"'《]+|[」』"'》]+$/g

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
    lines.push(`人物：${request.name}（${request.role}）`)
    if (request.age.length > 0) {
        lines.push(`年龄：${request.age}`)
    }
    if (request.identity.length > 0) {
        lines.push(`身份：${request.identity}`)
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
    lines.push('要求：外貌细节要能呼应这个人的经历与性格；不出现具体人名与地名；只写看得见的东西。')
    return lines.join('\n')
}

/** 清洗模型输出：去围栏、标题、列表与引号，合并空行并截断 */
export function sanitizeAppearance(content: string): string {
    const cleaned = content
        .replace(/```[a-zA-Z]*/g, '')
        .replace(/```/g, '')
        .split('\n')
        .map((line) =>
            line
                .replace(/^#{1,6}\s*/, '')
                .replace(BULLET_PATTERN, '')
                .replace(NUMBERING_PATTERN, '')
                .trim(),
        )
        .filter((line) => line.length > 0)
        .join('\n')
        .replace(WRAPPING_PATTERN, '')
        .trim()
    return cleaned.length > MAX_CONTENT_LENGTH ? `${cleaned.slice(0, MAX_CONTENT_LENGTH)}…` : cleaned
}
