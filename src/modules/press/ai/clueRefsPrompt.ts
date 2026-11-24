/**
 * 伏笔位置识别提示词：从章节正文摘录里找出每条伏笔的埋设与回收位置，输出纯 JSON。
 * 复用约定：沿用按卷生成章纲的 JSON 口径，消息结构取 @modules/ai/provider，解析结果按伏笔白名单与章节坐标校验。
 * 关键约束：只输出正文明确写出的位置，不确定不输出；模型输出不可信，解析失败按空结果返回，不把原文抛给页面。
 */
import type { AiChatMessage } from '@modules/ai/provider'
import type { ClueRefsAnalyzeInput, ClueRefSuggestion } from '@shared/types/press'

/** 建议条数上限：防止模型把同一伏笔铺满所有章节 */
const MAX_SUGGESTIONS = 60

/** 提示词：正文摘录按章分段，id 与坐标必须来自给定清单 */
export function buildClueRefsAnalyzeMessages(input: ClueRefsAnalyzeInput): AiChatMessage[] {
    const clueLines = input.clues
        .map((clue) => `- id=${clue.id} 名称=${clue.name}${clue.note.length > 0 ? ` 备注=${clue.note}` : ''}`)
        .join('\n')
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
                '你是小说伏笔位置识别助手。根据章节正文摘录，判断每条伏笔在哪一章埋设、在哪一章回收。',
                '只输出纯 JSON 数组，不要解释文字或代码块围栏。',
                '数组每项固定为 {"id":"伏笔id","action":"plant"|"payoff","volumeOrder":卷序,"chapterOrder":章序}。',
                'id 只能原样取自【待识别伏笔】；volumeOrder 与 chapterOrder 只能取自【章节摘录】标题里的坐标。',
                '只有正文明确写出该伏笔的埋设或回收才输出，不确定就不要输出；同一 id 与 action 只输出一条。',
            ].join('\n'),
        },
        {
            role: 'user',
            content: `【待识别伏笔】\n${clueLines}\n\n【章节摘录】\n${chapterBlocks}`,
        },
    ]
}

/** 模型输出收窄：去围栏、id 白名单、章节坐标存在性、action 合法与同键去重 */
export function parseClueRefSuggestions(
    content: string,
    clueIds: ReadonlySet<string>,
    chapterKeys: ReadonlySet<string>,
): ClueRefSuggestion[] {
    const json = content.trim().replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, '')
    let parsed: unknown
    try {
        parsed = JSON.parse(json)
    } catch {
        return []
    }
    if (!Array.isArray(parsed)) {
        return []
    }
    const refs: ClueRefSuggestion[] = []
    const seen = new Set<string>()
    for (const item of parsed.slice(0, MAX_SUGGESTIONS)) {
        if (typeof item !== 'object' || item === null) {
            continue
        }
        const record = item as Record<string, unknown>
        const id = typeof record.id === 'string' ? record.id : ''
        const action = record.action === 'plant' || record.action === 'payoff' ? record.action : null
        const volumeOrder =
            typeof record.volumeOrder === 'number' && Number.isInteger(record.volumeOrder) ? record.volumeOrder : 0
        const chapterOrder =
            typeof record.chapterOrder === 'number' && Number.isInteger(record.chapterOrder) ? record.chapterOrder : 0
        if (action === null || !clueIds.has(id) || volumeOrder <= 0 || chapterOrder <= 0) {
            continue
        }
        if (!chapterKeys.has(`${String(volumeOrder)}-${String(chapterOrder)}`)) {
            continue
        }
        const key = `${id}:${action}`
        if (seen.has(key)) {
            continue
        }
        seen.add(key)
        refs.push({ id, action, volumeOrder, chapterOrder })
    }
    return refs
}
