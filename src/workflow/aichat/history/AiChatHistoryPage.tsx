/**
 * 历史会话页：以整页承载会话列表，替代原来的浮层，便于按范围与来源浏览与迁移。
 * 复用约定：外壳取 components/AppPage（标题行左侧返回、下方筛选条），列表行取 ./layout/AiChatHistoryRow，
 * 空态取 Empty；筛选词表与空态文案分别在 ./utils/historyFilters 与 ./utils/emptyState，
 * 数据与筛选状态由调用方（useAiChatHistory）持有，本页只做装配与回调，不自行取数。
 * 关键约束：过滤只作用于已拉取的 50 条，不再发请求；筛选分两类 —— 「当前」按作用域、
 * 其余都基于全区列表在前端切分；选中后的迁移确认由调用方负责。
 */
import { History, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@components/ui/input-group'
import { ItemGroup } from '@components/ui/item'
import type { AiConversationSummary } from '@shared/types/aiChat'
import { BackAction } from '@webview/blocks/BackAction'
import { Empty } from '@webview/blocks/Empty'
import { AppContent, AppHeader, AppMenu, AppPage, AppTitle } from '@webview/components/AppPage'
import { SegmentedRail } from '@webview/components/SegmentedRail'
import type { SegmentedRailItem } from '@webview/components/SegmentedRail'
import { AiChatHistoryRow } from './layout/AiChatHistoryRow'
import { describeHistoryEmptyState } from './utils/emptyState'
import { HISTORY_MODE_LABELS, HISTORY_MODE_ORDER, readKindFilter } from './utils/historyFilters'
import type { AiChatHistoryMode } from './utils/historyFilters'
import type { JSX } from 'react'

/** 过滤词长度上限：与笔记搜索同口径，挡住误粘贴的长文；本地过滤不需要更长的关键词 */
const QUERY_MAX_LENGTH = 100

/** 筛选标签项：排列顺序与展示名都来自词表，页面只负责拼成组件需要的形状 */
const HISTORY_MODES: readonly SegmentedRailItem<AiChatHistoryMode>[] = HISTORY_MODE_ORDER.map((value) => ({
    value,
    label: HISTORY_MODE_LABELS[value],
}))

interface AiChatHistoryPageProps {
    sessions: AiConversationSummary[]
    activeSessionId: string | undefined
    mode: AiChatHistoryMode
    onModeChange: (mode: AiChatHistoryMode) => void
    onSelect: (id: string) => void
    onDelete: (id: string) => void
    onBack: () => void
}

export function AiChatHistoryPage({
    sessions,
    activeSessionId,
    mode,
    onModeChange,
    onSelect,
    onDelete,
    onBack,
}: AiChatHistoryPageProps): JSX.Element {
    const [query, setQuery] = useState('')
    const keyword = useMemo(() => query.trim().toLowerCase(), [query])
    const kindFilter = readKindFilter(mode)
    // 筛选只收窄列表：「当前」与「全部」沿用宿主返回的时间顺序，单一来源只列对应来源
    const matched = useMemo(() => {
        const visible =
            keyword.length === 0 ? sessions : sessions.filter((item) => item.title.toLowerCase().includes(keyword))
        return kindFilter === undefined ? visible : visible.filter((item) => item.scopeKind === kindFilter)
    }, [keyword, kindFilter, sessions])
    const emptyCopy = describeHistoryEmptyState({ sessions, keyword, kindFilter, mode })
    return (
        <AppPage>
            <AppHeader align="start">
                <BackAction label="返回对话" variant="ghost" onClick={onBack} />
                <AppTitle>历史对话</AppTitle>
                <AppMenu>
                    <SegmentedRail
                        items={HISTORY_MODES}
                        label="历史筛选"
                        size="sm"
                        value={mode}
                        onChange={onModeChange}
                    />
                </AppMenu>
            </AppHeader>
            <AppContent isScrollable>
                <InputGroup>
                    <InputGroupAddon>
                        <Search />
                    </InputGroupAddon>
                    <InputGroupInput
                        value={query}
                        maxLength={QUERY_MAX_LENGTH}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="按标题过滤"
                        aria-label="按标题过滤历史对话"
                    />
                </InputGroup>
                {matched.length === 0 ? (
                    <div className="flex flex-1 items-center justify-center py-10">
                        <Empty icon={History} title={emptyCopy.title} description={emptyCopy.description} />
                    </div>
                ) : (
                    <ItemGroup className="gap-2 py-3">
                        {matched.map((item) => (
                            <AiChatHistoryRow
                                key={item.id}
                                session={item}
                                isActive={item.id === activeSessionId}
                                onSelect={onSelect}
                                onDelete={onDelete}
                            />
                        ))}
                    </ItemGroup>
                )}
            </AppContent>
        </AppPage>
    )
}
