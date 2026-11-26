/**
 * 成长线识别提示词：从章节正文摘录里找出主角境界 / 战力与金手指等级的变化，输出纯 JSON。
 * 复用约定：消息结构取 @modules/ai/provider，解析结果按卷章坐标白名单与轨道白名单校验，与伏笔识别同一口径。
 * 关键约束：只输出正文明确写出的变化，不确定不输出；模型输出不可信，解析失败按空结果返回，不把原文抛给页面。
 */
import type { AiChatMessage } from '@modules/ai/provider'
import type { GrowthAnalyzeInput, GrowthPointSuggestion, PressGrowthTrack } from '@shared/types/press'

/** 建议条数上限：防止模型把每一次提及都当成成长节点 */
const MAX_SUGGESTIONS = 40
/** 成长值长度上限：自由文本但要短，便于按卷并列展示 */
const MAX_VALUE_LENGTH = 40
/** 备注长度上限 */
const MAX_NOTE_LENGTH = 100
/** 轨道白名单：与前端 GrowthTrack 一致 */
const GROWTH_TRACKS: readonly PressGrowthTrack[] = ['protagonist', 'goldenFinger']

/** 提示词：章节摘录按章分段，坐标必须来自给定清单，已有记录不要重复 */
export function buildGrowthAnalyzeMessages(input: GrowthAnalyzeInput): AiChatMessage[] {
    const existing = input.points.map((point) => `- ${point.track}：${point.value}`).join('\n')
    const chapterBlocks = input.chapters
        .map(
            (chapter) =>
                `【第${String(chapter.volumeOrder)}卷 第${String(chapter.chapterOrder)}章 ${chapter.title}】\n${chapter.excerpt}`,
        )
        .join('\n\n')
    return [
        {
            role: 'system',
            content: [
                '你是小说成长线识别助手。根据章节正文摘录，找出主角境界 / 战力与金手指等级发生变化的位置。',
                '只输出纯 JSON 数组，不要解释文字或代码块围栏。',
                '数组每项固定为 {"track":"protagonist"|"goldenFinger","value":"...","note":"...","volumeOrder":卷序,"chapterOrder":章序}。',
                'track 只能是 protagonist（主角自身）或 goldenFinger（金手指）；value 写变化后的状态，沿用原文写法。',
                'volumeOrder 与 chapterOrder 只能取自【章节摘录】标题里的坐标。',
                '只有正文明确写出变化才输出，不确定就不要输出；已有成长记录不要重复输出；同一章同一 track 只输出一条。',
            ].join('\n'),
        },
        {
            role: 'user',
            content: `【已有成长记录】\n${existing.length > 0 ? existing : '（无）'}\n\n【章节摘录】\n${chapterBlocks}`,
        },
    ]
}

/** 模型输出收窄：去围栏、轨道白名单、章节坐标存在性、值非空与同章同轨道去重 */
export function parseGrowthSuggestions(content: string, chapterKeys: ReadonlySet<string>): GrowthPointSuggestion[] {
    const json = content
        .trim()
        .replace(/^```(?:json)?\s*/u, '')
        .replace(/\s*```$/u, '')
    let parsed: unknown
    try {
        parsed = JSON.parse(json)
    } catch {
        return []
    }
    if (!Array.isArray(parsed)) {
        return []
    }
    const points: GrowthPointSuggestion[] = []
    const seen = new Set<string>()
    for (const item of parsed.slice(0, MAX_SUGGESTIONS)) {
        if (typeof item !== 'object' || item === null) {
            continue
        }
        const record = item as Record<string, unknown>
        const track =
            typeof record.track === 'string' ? GROWTH_TRACKS.find((value) => value === record.track) : undefined
        const volumeOrder =
            typeof record.volumeOrder === 'number' && Number.isInteger(record.volumeOrder) ? record.volumeOrder : 0
        const chapterOrder =
            typeof record.chapterOrder === 'number' && Number.isInteger(record.chapterOrder) ? record.chapterOrder : 0
        const value = typeof record.value === 'string' ? record.value.trim().slice(0, MAX_VALUE_LENGTH) : ''
        if (
            track === undefined ||
            value.length === 0 ||
            volumeOrder <= 0 ||
            chapterOrder <= 0 ||
            !chapterKeys.has(`${String(volumeOrder)}-${String(chapterOrder)}`)
        ) {
            continue
        }
        const key = `${track}:${String(volumeOrder)}-${String(chapterOrder)}`
        if (seen.has(key)) {
            continue
        }
        seen.add(key)
        points.push({
            track,
            value,
            note: typeof record.note === 'string' ? record.note.trim().slice(0, MAX_NOTE_LENGTH) : '',
            volumeOrder,
            chapterOrder,
        })
    }
    return points
}
