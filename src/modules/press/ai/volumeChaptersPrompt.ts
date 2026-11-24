/**
 * 按卷生成章纲提示词：卷纲 + 全书结构 + 本卷伏笔折算成一次分章请求。
 * 复用约定：消息结构取 @modules/ai/provider，设定事实行复用 ./settingFieldPrompt，文本折行复用 ./plainText。
 * 关键约束：阶段仍由本卷主要情节决定、结构只作转折约束；线索关联只能回指请求 id；
 * 输出纯 JSON 数组（含 clueRefs），解析与白名单校验在宿主侧完成。
 */
import type { AiChatMessage } from '@modules/ai/provider'
import type { VolumeChaptersGenerateRequest } from '@shared/types/press'
import { toSingleLine } from './plainText'
import { buildSettingFactLines } from './settingFieldPrompt'

/** 系统提示：限定输出形态与职责边界 */
const SYSTEM_PROMPT = `你是中文网络小说的分卷大纲策划。作者已经写好这一卷的卷纲，你要把它拆成逐章的章纲。
只输出一个 JSON 数组，不要解释、不要标题、不要 Markdown 代码围栏。
数组每一项的格式固定为 {"stage":"阶段名","title":"章标题","summary":"计划梗概","beats":["节拍一","节拍二"],"clueRefs":[{"id":"线索id","action":"plant"}]}，不要增删字段。
clueRefs 的 id 只能原样取自【本卷伏笔】清单，action 只能是 plant（埋设）或 payoff（回收）；本章不承担线索时写空数组。
不得编造与卷纲、作品设定、全书结构冲突的情节；卷纲没写到的地方按既有事件链最合理地补齐，不另起主线。`

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

/** 全书结构事实行：阶段名、位置与关键事件，供本卷分章时对齐转折语义 */
function buildActLines(request: VolumeChaptersGenerateRequest): string[] {
    return request.acts.flatMap((act, index) => {
        const name = toSingleLine(act.name)
        if (name.length === 0) {
            return []
        }
        const lines = [`阶段${String(index + 1)}：${name}`]
        const kind = toSingleLine(act.kind)
        if (kind.length > 0 && kind !== '未指定') {
            lines.push(`转折类型：${kind}`)
        }
        if (act.volumeOrder !== null) {
            lines.push(`卷位：第${String(act.volumeOrder)}卷`)
        }
        const role = toSingleLine(act.narrativeRole)
        if (role.length > 0) {
            lines.push(`叙事作用：${role}`)
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

/** 本卷伏笔事实行：id 原样给出供回指，章节引用与备注按原文折行 */
function buildClueLines(request: VolumeChaptersGenerateRequest): string[] {
    return request.clues.flatMap((clue) => {
        const name = toSingleLine(clue.name)
        if (clue.id.length === 0 || name.length === 0) {
            return []
        }
        const lines = [`- id：${clue.id}｜线索：${name}`]
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

/** 构造按卷生成章纲的消息 */
export function buildVolumeChaptersMessages(request: VolumeChaptersGenerateRequest): AiChatMessage[] {
    return [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(request) },
    ]
}

/** 用户提示：作品设定 → 全书结构 → 卷纲 → 伏笔 → 章节范围 → 写作要求 */
function buildUserPrompt(request: VolumeChaptersGenerateRequest): string {
    const settingFacts = buildSettingFactLines(request.setting)
    const actLines = buildActLines(request)
    const clueLines = buildClueLines(request)
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
        '【全书结构】',
        ...(actLines.length > 0 ? actLines : ['结构纲尚未填写，按卷纲自行安排转折']),
        '',
        '【本卷卷纲】',
        ...buildVolumeFactLines(request),
        '',
        '【本卷伏笔】',
        ...(clueLines.length > 0 ? clueLines : ['本卷没有待埋设或待回收的线索']),
        '',
        '【章节范围】',
        `起始章序：${chapterRange}`,
        readChapterCountHint(request),
        existing,
        `可出场人物：${cast}`,
        '',
        '【写作要求】',
        '- stage 严格沿用「主要情节」里的阶段划分，写成「第一阶段：坠楼与觉醒」这种形式；没有阶段信息时用空串',
        '- 【全书结构】只标全书级大转折，本卷自己的转折看卷纲「关键转折」；阶段语义不得与全书结构冲突、也不要照搬阶段名，卷位落在本卷的转折要呼应其主角变化',
        '- title 取 6~20 字，不写「第N章」序号；需要分上下时写进标题（如「肇事司机一家（上）」）',
        `- summary 取 ${SUMMARY_LENGTH_HINT}：谁做了什么、付出什么代价、留下什么钩子，不写「本章讲述了」这类套话`,
        `- beats 是本章细纲：${BEAT_COUNT_HINT}，按先后顺序写清「谁做了什么→遭遇什么→结果如何」，一条一个动作或转折`,
        '- 按【本卷伏笔】的埋设章与回收章，把对应线索安排到具体章节，并在该章 clueRefs 写 {id, action}；id 原样照抄，不确定不要写',
        '- 一章一条，章序连续，不合并不跳号；同一事件跨度大时按阶段拆成多章',
        '- 只输出 JSON 数组，不要任何解释文字',
    ].join('\n')
}
