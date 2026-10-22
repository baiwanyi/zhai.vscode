/**
 * 角色配图场景描述提示词：把人物卡交给文本模型，产出一句可直接出图的画面描述。
 * 复用约定：消息结构复用 ../../ai/provider 的 AiChatMessage；画风与禁止项仍由 portraitPrompt 负责，本层只产出「画面」。
 * 关键约束：模型输出一律视为不可信——去前缀、去引号、压空白并截断长度；
 * 描述不得出现画风词与说明性文字，且场景须贴合身份、能力与世界观，避免现代物品串入古风题材。
 */
import type { PortraitGenerateRequest } from '../../../shared/types/press'
import type { AiChatMessage as ChatMessage } from '../../ai/provider'

/** 系统提示：只写画面，不写画风与解释 */
const SYSTEM_PROMPT = `你是中文网文的配图画面设计师。根据人物卡写一句能直接交给绘图模型的画面描述。
只写画面：人物在做什么、身处何地、光线与镜头怎么给；不写画风、不写禁止项、不写「提示词」「画面」之类的说明字样。
中文，60~120 字，一整段，不加引号、不用列表、不要解释。画面中只出现该角色一人，场景须贴合其身份与所处世界观。`

/** 场景描述长度上限：超出即截断，避免把出图提示词撑爆 */
const MAX_SCENE_LENGTH = 120
/** 模型可能自带的前缀 */
const PREFIX_PATTERN = /^(画面|场景|提示词|描述)[:：]\s*/
/** 首尾可能出现的引号与书名号 */
const WRAPPING_PATTERN = /^[「『"'《]+|[」』"'》]+$/g

/** 构造场景描述消息 */
export function buildSceneMessages(request: PortraitGenerateRequest): ChatMessage[] {
    return [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(request) },
    ]
}

/** 清洗模型输出：去掉前缀、引号与多余空白，压缩为一行后截断 */
export function sanitizeScene(raw: string): string {
    const text = raw.replace(PREFIX_PATTERN, '').replace(WRAPPING_PATTERN, '').replace(/\s+/g, ' ').trim()
    return text.length > MAX_SCENE_LENGTH ? text.slice(0, MAX_SCENE_LENGTH) : text
}

/** 用户提示：人物已填字段 + 世界观，空字段不占行 */
function buildUserPrompt(request: PortraitGenerateRequest): string {
    const background = [...request.genres, request.era].filter((item) => item.length > 0).join('｜')
    const lines = [`作品背景：${background.length > 0 ? background : '未限定，按现代都市处理'}`]
    if (request.tone.length > 0) {
        lines.push(`文风基调：${request.tone}`)
    }
    lines.push(`人物：${request.name}（${request.role}·${request.gender}）`)
    if (request.age.length > 0) {
        lines.push(`年龄：${request.age}`)
    }
    if (request.identity.length > 0) {
        lines.push(`身份：${request.identity}`)
    }
    if (request.appearance.length > 0) {
        lines.push(`外貌：${request.appearance}`)
    }
    if (request.traits.length > 0) {
        lines.push(`性格：${request.traits.join('、')}`)
    }
    if (request.desire.length > 0) {
        lines.push(`欲望：${request.desire}`)
    }
    if (request.weakness.length > 0) {
        lines.push(`弱点：${request.weakness}`)
    }
    if (request.ability.length > 0) {
        lines.push(`能力：${request.ability}`)
    }
    lines.push('请写出这一刻的画面：地点、正在做的事、光线，一句到底。')
    return lines.join('\n')
}
