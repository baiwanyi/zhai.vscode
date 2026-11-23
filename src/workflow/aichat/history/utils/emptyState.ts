/**
 * 历史页空态文案：区分「一条记录都没有」「过滤无结果」「当前来源无记录」三种情况。
 * 复用约定：筛选展示名取 historyFilters 的 HISTORY_MODE_LABELS，与页头标签同源，避免文案漂移。
 * 关键约束：标题与描述成对返回，调用处不得只取其中一个再自行拼另一段；
 * 「当前 / 全部」是范围筛选（kindFilter 为 undefined），只有单一来源筛选才出现「某来源下还没有会话」。
 */
import type { AiConversationScopeKind, AiConversationSummary } from '@shared/types/aiChat'
import { HISTORY_MODE_LABELS } from './historyFilters'
import type { AiChatHistoryMode } from './historyFilters'

/** 空态文案：标题与描述成对出现 */
export interface HistoryEmptyStateCopy {
    title: string
    description: string
}

/** 空态推导入参：三种空态共用一次判定 */
export interface DescribeHistoryEmptyStateInput {
    sessions: AiConversationSummary[]
    keyword: string
    /** undefined 表示「当前 / 全部」这两个范围筛选，而不是按来源筛选 */
    kindFilter: AiConversationScopeKind | undefined
    mode: AiChatHistoryMode
}

const SOURCE_EMPTY_DESCRIPTION = '该来源在最近 50 条会话里没有记录，可切到「全部」再看一次。'

export function describeHistoryEmptyState({
    sessions,
    keyword,
    kindFilter,
    mode,
}: DescribeHistoryEmptyStateInput): HistoryEmptyStateCopy {
    if (sessions.length === 0) {
        return {
            title: '暂无历史对话',
            description: '在当前对象里发起一次对话后，这里会留下记录；需要找其它对象的记录可切到「全部」。',
        }
    }
    if (keyword.length > 0) {
        return { title: '没有匹配的对话', description: '换个关键词再试，或清空过滤条件。' }
    }
    if (kindFilter === undefined) {
        return { title: '暂无历史对话', description: SOURCE_EMPTY_DESCRIPTION }
    }
    return {
        title: `「${HISTORY_MODE_LABELS[mode]}」下还没有会话`,
        description: SOURCE_EMPTY_DESCRIPTION,
    }
}
