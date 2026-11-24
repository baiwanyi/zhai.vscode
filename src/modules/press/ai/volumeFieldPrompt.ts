/**
 * 卷纲单字段提示词：只补「核心事件」或「卷末结果」一项，其余字段作为上下文。
 * 复用约定：消息结构复用 ../../ai/provider 的 AiChatMessage；已填设定的事实行由 ./settingFieldPrompt 的
 * buildSettingFactLines 统一产出；多行文本进提示词前统一折成单行。
 * 关键约束：输出是纯文本而不是 JSON——单字段没有多条结构，直接落进输入框；
 * 模型只能写请求的那一项，不得重写卷名、预计章节数、主要情节与关键转折。
 */
import type { AiChatMessage } from '@modules/ai/provider'
import type { VolumeFieldGenerateRequest, VolumeFieldKey } from '@shared/types/press'
import { toSingleLine } from './plainText'
import { buildSettingFactLines } from './settingFieldPrompt'

/** 系统提示：限定职责边界与输出形态 */
const SYSTEM_PROMPT = `你是中文网络小说的分卷策划。作者正在写某一卷的卷纲，你要补写其中一项。
只输出这一项的正文，不要标题、不要解释、不要 Markdown 标记、不要引号包裹。`

/** 两个字段的写作要求：篇幅与落笔重点 */
const FIELD_SPECS: Readonly<Record<VolumeFieldKey, { title: string; requirement: string[] }>> = {
    coreEvent: {
        title: '核心事件',
        requirement: [
            '写 80~200 字的一段：这一卷谁因为什么必须去做什么，谁 / 什么在阻碍，付出的代价是什么',
            '只写这一卷的主线因果，不写具体章节，也不要罗列事件清单',
        ],
    },
    result: {
        title: '卷末结果',
        requirement: [
            '写 40~120 字的一段：卷末目标达成或失败、主角付出的代价，以及留给下一卷的新问题',
            '结果要落在人物处境上，不要写「为后续埋下伏笔」这类套话',
        ],
    },
}

/** 卷现状：把作者已写的内容折成事实行，模型据此续写而不是另起一套 */
function buildVolumeFactLines(request: VolumeFieldGenerateRequest): string[] {
    const lines: string[] = [`卷名：${toSingleLine(request.volumeName)}`]
    if (request.coreEvent.trim().length > 0) {
        lines.push(`现有核心事件：${toSingleLine(request.coreEvent)}`)
    }
    const mainPlot = request.mainPlot.map((item) => item.trim()).filter((item) => item.length > 0)
    if (mainPlot.length > 0) {
        lines.push('主要情节：', ...mainPlot.map((item) => `- ${toSingleLine(item)}`))
    }
    const turningPoints = request.turningPoints.map((item) => item.trim()).filter((item) => item.length > 0)
    if (turningPoints.length > 0) {
        lines.push(`关键转折：${turningPoints.join('；')}`)
    }
    if (request.result.trim().length > 0) {
        lines.push(`现有卷末结果：${toSingleLine(request.result)}`)
    }
    return lines
}

/** 用户提示：作品设定 → 卷现状 → 本次要写的字段与要求 */
function buildUserPrompt(request: VolumeFieldGenerateRequest): string {
    const spec = FIELD_SPECS[request.field]
    const settingFacts = buildSettingFactLines(request.setting)
    const cast = request.characters.length > 0 ? request.characters.join('、') : '尚未创建人物卡'
    return [
        '【作品设定】',
        ...(settingFacts.length > 0 ? settingFacts : ['设定尚未填写，按常见题材自行取舍']),
        '',
        '【可出场人物】',
        cast,
        '',
        '【本卷现状】',
        ...buildVolumeFactLines(request),
        '',
        `【本次只写：${spec.title}】`,
        ...spec.requirement.map((item) => `- ${item}`),
        '- 不要重复输出其它字段，也不要写章节标题',
    ].join('\n')
}

/** 构造卷纲单字段生成的消息 */
export function buildVolumeFieldMessages(request: VolumeFieldGenerateRequest): AiChatMessage[] {
    return [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(request) },
    ]
}
