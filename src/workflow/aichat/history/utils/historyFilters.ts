/**
 * 历史页词表：筛选标签的展示名与排列顺序、筛选值到会话来源类型的映射、行内来源文案。
 * 复用约定：来源名（作品 / 笔记 / 公众号 / 微博）只在这里定义一次，筛选标签、行内来源与空态文案共用；
 * 筛选类型 AiChatHistoryMode 也在这里定义，数据层（useAiChatHistory）与页面都从这里取，避免两处各写一份。
 * 关键约束：本文件不得依赖 UI 组件（例如 SegmentedRail 的 items 类型），标签项由页面拼装；
 * 「当前 / 全部」是范围筛选、不对应任何来源类型，用 undefined 作哨兵与 null（通用对话）区分。
 */
import type { AiConversationScopeKind, AiConversationSummary } from '@shared/types/aiChat'

/** 历史筛选：当前对象与全部是范围，其余按来源类型筛选 */
export type AiChatHistoryMode = 'scope' | 'all' | 'note' | 'press' | 'wechat' | 'weibo' | 'general'

/** 筛选标签的排列顺序：当前 / 全部 / 各来源；顺序固定，便于形成肌肉记忆 */
export const HISTORY_MODE_ORDER = ['scope', 'all', 'note', 'press', 'wechat', 'weibo', 'general'] as const

/** 来源类型 → 展示名：行内来源前缀与筛选标签共用这一份 */
export const SCOPE_KIND_LABELS: Readonly<Record<Exclude<AiConversationScopeKind, null>, string>> = {
    press: '作品',
    note: '笔记',
    wechat: '公众号',
    weibo: '微博',
}

/** 筛选值 → 展示名：来源项直接展开，避免标签与来源名两处各写一套 */
export const HISTORY_MODE_LABELS: Readonly<Record<AiChatHistoryMode, string>> = {
    scope: '当前',
    all: '全部',
    ...SCOPE_KIND_LABELS,
    general: '通用对话',
}

/** 单一来源筛选 → 会话来源类型；general 对应无归属的通用对话 */
const FILTER_KINDS: Readonly<Record<Exclude<AiChatHistoryMode, 'scope' | 'all'>, AiConversationScopeKind>> = {
    note: 'note',
    press: 'press',
    wechat: 'wechat',
    weibo: 'weibo',
    general: null,
}

/** 读取来源筛选对应的类型；undefined 表示「当前 / 全部」这两个范围筛选 */
export function readKindFilter(mode: AiChatHistoryMode): AiConversationScopeKind | undefined {
    return mode === 'scope' || mode === 'all' ? undefined : FILTER_KINDS[mode]
}

/** 行内来源文案：通用对话只显示标签，其余拼「类型 · 对象名」 */
export function formatScopeText(session: AiConversationSummary): string {
    return session.scopeKind === null
        ? session.scopeLabel
        : `${SCOPE_KIND_LABELS[session.scopeKind]} · ${session.scopeLabel}`
}
