/**
 * 按卷生成章纲提示词：把作者的卷纲（核心事件、主要情节、转折与卷末结果）折算成一次分章请求。
 * 复用约定：消息结构复用 ../../ai/provider 的 AiChatMessage；已填设定的事实行由 ./settingFieldPrompt 的
 * buildSettingFactLines 统一产出，避免与设定生成两处各写一份口径；多行文本进提示词前统一折成可读段落。
 * 关键约束：除「阶段 / 标题 / 计划梗概」外还要求输出「节拍」（章节细纲，3~6 条），
 * POV 与出场人物仍留给作者逐章细化；
 * 输出必须是纯 JSON 数组（不带代码围栏），解析与截断在 pressAiService 侧完成；
 * 阶段名与章序由卷纲的「主要情节」决定，模型不得自行发明新的阶段划分。
 */
import type { AiChatMessage } from '@modules/ai/provider'
import type { VolumeChaptersGenerateRequest } from '@shared/types/press'
import { toSingleLine } from './plainText'
import { buildSettingFactLines } from './settingFieldPrompt'

/** 系统提示：限定输出形态与职责边界 */
const SYSTEM_PROMPT = `你是中文网络小说的分卷大纲策划。作者已经写好这一卷的卷纲，你要把它拆成逐章的章纲。
只输出一个 JSON 数组，不要解释、不要标题、不要 Markdown 代码围栏。
数组每一项的格式固定为 {"stage":"阶段名","title":"章标题","summary":"计划梗概","beats":["节拍一","节拍二"]}，不要增删字段。
不得编造与卷纲、作品设定冲突的情节；卷纲没写到的地方按既有事件链最合理地补齐，不另起主线。`

/** 单章介绍的篇幅：写满但不啰嗦 */
const SUMMARY_LENGTH_HINT = '60~120 字'

/** 单章节拍的条数范围：既是提示词要求，也是解析侧的期望 */
const BEAT_COUNT_HINT = '3~6 条'

/** 期望章数的说明：0 表示交给模型按卷纲推断 */
function readChapterCountHint(request: VolumeChaptersGenerateRequest): string {
    return request.chapterCount > 0
        ? `期望章数：${String(request.chapterCount)} 章（可上下浮动 2 章，章序必须连续）`
        : '期望章数：按卷纲里的阶段与事件量自行推断，章序必须连续'
}

/** 卷纲事实行：卷纲本身是作者原文，逐项折行输出，空字段不写占位 */
function buildVolumeFactLines(request: VolumeChaptersGenerateRequest): string[] {
    const lines: string[] = [`卷名：${request.volumeName}`]
    if (request.coreEvent.trim().length > 0) {
        lines.push(`核心事件：${toSingleLine(request.coreEvent)}`)
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
        lines.push(`卷末结果：${toSingleLine(request.result)}`)
    }
    return lines
}

/** 构造按卷生成章纲的消息 */
export function buildVolumeChaptersMessages(request: VolumeChaptersGenerateRequest): AiChatMessage[] {
    return [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(request) },
    ]
}

/** 用户提示：作品设定 → 卷纲 → 章节范围 → 写作要求 */
function buildUserPrompt(request: VolumeChaptersGenerateRequest): string {
    const settingFacts = buildSettingFactLines(request.setting)
    const chapterRange = `第 ${String(request.startOrder)} 章 起`
    const existing =
        request.existingCount > 0
            ? `卷内已有 ${String(request.existingCount)} 章：新章接在它们之后，不要重复已有内容`
            : '卷内还没有章纲：从起始章序开始铺'
    const cast = request.characters.length > 0 ? request.characters.join('、') : '尚未创建人物卡'

    return [
        '【作品设定】',
        ...(settingFacts.length > 0 ? settingFacts : ['其它设定尚未填写，按题材与卷纲推断']),
        '',
        '【本卷卷纲】',
        ...buildVolumeFactLines(request),
        '',
        '【章节范围】',
        `起始章序：${chapterRange}`,
        readChapterCountHint(request),
        existing,
        `可出场人物：${cast}`,
        '',
        '【写作要求】',
        '- stage 严格沿用「主要情节」里的阶段划分，写成「第一阶段：坠楼与觉醒」这种形式；没有阶段信息时用空串',
        '- title 取 6~20 字，不写「第N章」序号；需要分上下时写进标题（如「肇事司机一家（上）」）',
        `- summary 取 ${SUMMARY_LENGTH_HINT}：谁做了什么、付出什么代价、留下什么钩子，不写「本章讲述了」这类套话`,
        `- beats 是本章细纲：${BEAT_COUNT_HINT}，按先后顺序写清「谁做了什么→遭遇什么→结果如何」，一条一个动作或转折`,
        '- 一章一条，章序连续，不合并不跳号；同一事件跨度大时按阶段拆成多章',
        '- 只输出 JSON 数组，不要任何解释文字',
    ].join('\n')
}
