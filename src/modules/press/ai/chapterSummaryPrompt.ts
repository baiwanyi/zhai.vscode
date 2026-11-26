/**
 * 章纲计划梗概提示词：把本章章纲卡、卷纲、全书结构、设定与前后章线索折成一次单字段请求。
 * 复用约定：消息结构取 @modules/ai/provider 的 AiChatMessage，设定事实行复用 ./settingFieldPrompt 的
 * buildSettingFactLines，多行文本进提示词前统一由 ./plainText 折成单行。
 * 关键约束：输出是纯文本而非 JSON，直接落入计划梗概输入框；summary 是「打算写」不是正文事实，
 * 正文回写的 actualSummary 不进请求；阶段、钩子与节奏只作写作约束，模型不得回写这些字段。
 */
import type { AiChatMessage } from '@modules/ai/provider'
import type { ChapterSummaryGenerateRequest } from '@shared/types/press'
import { toSingleLine } from './plainText'
import { buildSettingFactLines } from './settingFieldPrompt'

/** 系统提示：限定职责边界与输出形态 */
const SYSTEM_PROMPT = `你是中文网络小说的章纲策划。作者已经定好这一章的章纲卡，你要据此补写「计划梗概」。
只输出这一段正文，不要标题、不要解释、不要 Markdown 标记、不要引号包裹。
梗概写的是「打算怎么写」，不是已经写出来的正文事实。`

/** 单章计划梗概的篇幅：与输入框 200 字上限留有余量 */
const SUMMARY_LENGTH_HINT = '60~200 字'

/** 章纲卡事实行：作者已填的字段逐项折行，空字段不写占位 */
function buildChapterFactLines(request: ChapterSummaryGenerateRequest): string[] {
    const lines: string[] = [`卷名：${toSingleLine(request.volumeName)}`, `章名：${toSingleLine(request.chapterTitle)}`]
    const fields: readonly [string, string][] = [
        ['阶段', request.stage],
        ['视角', request.pov],
        ['目标', request.goal],
        ['阻碍', request.obstacle],
        ['转折', request.turn],
        ['结果', request.result],
        ['情绪', request.emotion],
        ['章末钩子', request.hook],
        ['节奏', request.pacing],
    ]
    for (const [label, value] of fields) {
        const text = toSingleLine(value)
        if (text.length > 0) {
            lines.push(`${label}：${text}`)
        }
    }
    const beats = request.beats.map((item) => item.trim()).filter((item) => item.length > 0)
    if (beats.length > 0) {
        lines.push('节拍：', ...beats.map((item) => `- ${toSingleLine(item)}`))
    }
    const scenes = request.scenes.map((item) => item.trim()).filter((item) => item.length > 0)
    if (scenes.length > 0) {
        lines.push('场景：', ...scenes.map((item) => `- ${toSingleLine(item)}`))
    }
    const cast = request.characters.map((item) => item.trim()).filter((item) => item.length > 0)
    lines.push(`出场人物：${cast.length > 0 ? cast.join('、') : '尚未指定'}`)
    const summary = toSingleLine(request.summary)
    if (summary.length > 0) {
        lines.push(`现有计划梗概：${summary}`)
    }
    return lines
}

/** 本卷卷纲事实行：只取与主线和阶段相关的字段 */
function buildVolumeFactLines(request: ChapterSummaryGenerateRequest): string[] {
    const lines: string[] = []
    const coreEvent = toSingleLine(request.coreEvent)
    if (coreEvent.length > 0) {
        lines.push(`核心事件：${coreEvent}`)
    }
    const mainPlot = request.mainPlot.map((item) => item.trim()).filter((item) => item.length > 0)
    if (mainPlot.length > 0) {
        lines.push('主要情节：', ...mainPlot.map((item) => `- ${toSingleLine(item)}`))
    }
    return lines
}

/** 全书结构事实行：阶段名与转折语义，仅作约束不照搬 */
function buildActLines(request: ChapterSummaryGenerateRequest): string[] {
    return request.acts.flatMap((act, index) => {
        const name = toSingleLine(act.name)
        if (name.length === 0) {
            return []
        }
        const lines = [`阶段${String(index + 1)}：${name}`]
        if (act.kind !== '未指定') {
            lines.push(`转折类型：${act.kind}`)
        }
        if (act.volumeOrder !== null) {
            lines.push(`卷位：第${String(act.volumeOrder)}卷`)
        }
        const event = toSingleLine(act.event)
        if (event.length > 0) {
            lines.push(`关键事件：${event}`)
        }
        const change = toSingleLine(act.protagonistChange)
        if (change.length > 0) {
            lines.push(`主角变化：${change}`)
        }
        return lines
    })
}

/** 本章伏笔事实行：埋设与回收坐标原样给出，供梗概安排位置 */
function buildClueLines(request: ChapterSummaryGenerateRequest): string[] {
    return request.clues.flatMap((clue) => {
        const name = toSingleLine(clue.name)
        if (clue.id.length === 0 || name.length === 0) {
            return []
        }
        const lines = [`- 线索：${name}`]
        if (clue.plant.length > 0) {
            lines.push(`  埋设章：${clue.plant}`)
        }
        if (clue.payoff.length > 0) {
            lines.push(`  回收章：${clue.payoff}`)
        }
        const note = toSingleLine(clue.note)
        if (note.length > 0) {
            lines.push(`  备注：${note}`)
        }
        return lines
    })
}

/** 用户提示：作品设定 → 全书结构 → 本卷卷纲 → 前情 → 本章 → 写作要求 */
function buildUserPrompt(request: ChapterSummaryGenerateRequest): string {
    const settingFacts = buildSettingFactLines(request.setting)
    const actLines = buildActLines(request)
    const clueLines = buildClueLines(request)
    const volumeLines = buildVolumeFactLines(request)
    const prev = toSingleLine(request.prevSummary)
    return [
        '【作品设定】',
        ...(settingFacts.length > 0 ? settingFacts : ['设定尚未填写，按已有章纲自行取舍']),
        '',
        '【全书结构】',
        ...(actLines.length > 0 ? actLines : ['结构纲尚未填写，按本卷卷纲安排转折']),
        '',
        '【本卷卷纲】',
        ...(volumeLines.length > 0 ? volumeLines : ['本卷卷纲尚未填写']),
        '',
        '【上一章梗概】',
        prev.length > 0 ? prev : '没有上一章，本章即开篇',
        '',
        '【本章伏笔】',
        ...(clueLines.length > 0 ? clueLines : ['本章不承担线索埋设或回收']),
        '',
        '【本章章纲卡】',
        ...buildChapterFactLines(request),
        '',
        '【写作要求】',
        `- 写 ${SUMMARY_LENGTH_HINT} 的一段：谁想要什么、遇到什么阻碍、做出什么选择、结果如何、留下什么钩子`,
        '- 用已有章纲卡与节拍组织因果，不要另起主线，也不要照抄字段原句',
        '- 现有计划梗概非空时在其基础上完善，不推翻既有安排；没有梗概时按章纲卡新写',
        '- 只写打算怎么写的情节安排，不写正文已经发生的事实与字数进度',
        '- 不要输出阶段、钩子、节奏的字段值，也不要写「本章讲述了」这类套话',
    ].join('\n')
}

/** 构造章纲计划梗概生成的消息 */
export function buildChapterSummaryMessages(request: ChapterSummaryGenerateRequest): AiChatMessage[] {
    return [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(request) },
    ]
}
