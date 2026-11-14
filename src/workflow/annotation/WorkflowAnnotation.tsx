/**
 * 标注总览页：跨文档查看所有划线与批注，支持类型筛选、失效筛选与关键词检索。
 * 复用约定：外壳取 AppPage 骨架，列表区块取 layout/AnnotationListSection，数据编排在 hooks/useAnnotationList；
 * 页面自身只留筛选与页签，提示条 / 空态 / 条目的容器都在区块内，不在这里重复搭结构。
 * 关键约束：类型页签取 SegmentedRail，只有划线 / 批注 / 查询三档，默认落在划线且首屏条件同源；
 * 「查询」只切视图，不下发到标注列表查询——选中时收起标注侧筛选与列表，只留查询记录区块；
 * 颜色只有划线才有，切到其余页签时连条件一起清空，避免留下看不见的筛选；
 * 跳转打开的是文本编辑器并选中区间（富文本 tab 需用户自行切回）；
 * 跳转失败必须给出可见提示——文档已删除与定位失效分开说明，不能让点击毫无反应。
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Input } from '@components/ui/input'
import type { AnnotationStats } from '@shared/types/editor'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
import {
    AppAction,
    AppContent,
    AppDescription,
    AppHeader,
    AppMenu,
    AppPage,
    AppTitle,
} from '@webview/components/AppPage'
import { Button } from '@webview/components/Button'
import { SegmentedRail } from '@webview/components/SegmentedRail'
import type { SegmentedRailItem } from '@webview/components/SegmentedRail'
import { ANNOTATION_COLORS } from './colors'
import { useAnnotationList } from './hooks/useAnnotationList'
import { AnnotationListSection } from './layout/AnnotationListSection'
import { QueryRecordSection } from './layout/QueryRecordSection'
import type { AnnotationFilters } from './hooks/useAnnotationList'
import type { JSX } from 'react'

/** 视图页签：划线 / 批注是标注的单一类型，查询切到 AI 解释记录 */
type KindTab = 'highlight' | 'note' | 'query'

/** 类型页签：划线 / 批注 / 查询 */
const KIND_OPTIONS: readonly SegmentedRailItem<KindTab>[] = [
    { value: 'highlight', label: '划线' },
    { value: 'note', label: '批注' },
    { value: 'query', label: '查询' },
]

/** 页签默认停在划线：首屏与页签选中态保持一致 */
const DEFAULT_KIND_TAB: KindTab = 'highlight'

/** 页签 → 标注类型：查询不查标注表，按「不限」处理 */
function toAnnotationKind(tab: KindTab): AnnotationFilters['kind'] {
    return tab === 'query' ? null : tab
}

/** 跳转失败与成功定位不到时的提示文案 */
const NOTICE_MISSING_FILE = '原文不可用，无法跳转；该文档的标注已标记为失效'
const NOTICE_ORPHANED = '原文已修改，无法精确定位；已打开文档供你手动查找'

export function WorkflowAnnotation(): JSX.Element {
    const { items, isLoading, error, hasMore, filters, setFilters, loadMore, updateColor, remove, reveal } =
        useAnnotationList(toAnnotationKind(DEFAULT_KIND_TAB))
    const [notice, setNotice] = useState<string | null>(null)
    const [stats, setStats] = useState<AnnotationStats | null>(null)
    /** 当前选中的类型页签：「查询」只看 AI 解释，标注侧的筛选与列表一并收起 */
    const [activeKind, setActiveKind] = useState<KindTab>(DEFAULT_KIND_TAB)
    const isQueryView = activeKind === 'query'
    const isHighlightTab = activeKind === 'highlight'

    /** 切页签：颜色只有划线才有，切到批注或查询时一并清掉，避免留下看不见的条件 */
    const handleKindChange = (next: KindTab): void => {
        setActiveKind(next)
        setFilters({ ...filters, kind: toAnnotationKind(next), color: next === 'highlight' ? filters.color : null })
    }

    /** 拉一次统计：页头计数与「失效 N」都从这里来 */
    const loadStats = useCallback(async (): Promise<void> => {
        try {
            setStats(await request<AnnotationStats>('annotation/stats', {}))
        } catch {
            setStats(null)
        }
    }, [])

    // 统计随条目数变化重新拉一次：删除或新建后总数要跟着变，失败不影响列表展示
    useEffect(() => {
        void loadStats()
    }, [loadStats, items.length])

    const handleReveal = async (id: string): Promise<void> => {
        try {
            const outcome = await reveal(id)
            if (!outcome.revealed) {
                const message = outcome.reason === 'missing-file' ? NOTICE_MISSING_FILE : '这条标注已不存在'
                setNotice(message)
                // 列表可能已滚到中间，顶部提示条看不见：跳转失败一律再补一条 toast
                toast.error(message)
                if (outcome.reason === 'missing-file') {
                    // 宿主刚把这批标注置失效：页头的失效数要跟着变
                    void loadStats()
                }
                return
            }
            setNotice(outcome.orphaned === true ? NOTICE_ORPHANED : null)
        } catch (cause) {
            // 宿主拒绝（如路径越界）同样要有回音，不能让点击毫无反应
            toastError(cause)
        }
    }

    return (
        <AppPage>
            <AppHeader>
                <AppTitle>标注</AppTitle>
                <AppAction>
                    <Button
                        variant={filters.orphanedOnly ? 'default' : 'ghost'}
                        onClick={(): void => {
                            setFilters({ ...filters, orphanedOnly: !filters.orphanedOnly })
                        }}
                    >
                        仅看失效
                    </Button>
                </AppAction>
                {stats === null ? null : (
                    <AppDescription>
                        共 {stats.total} 条 · 划线 {stats.highlights} · 批注 {stats.notes} · 查询 {stats.queries}
                        {stats.orphaned === 0 ? '' : ` · 失效 ${stats.orphaned}`}
                    </AppDescription>
                )}
                <AppMenu className="flex-col items-start">
                    <div className="flex w-full items-center gap-1">
                        <SegmentedRail
                            items={KIND_OPTIONS}
                            ariaLabel="标注类型"
                            variant="outline"
                            value={activeKind}
                            onChange={handleKindChange}
                        />
                        <Input
                            value={filters.keyword}
                            placeholder="搜索划线 / 批注 / 查询..."
                            className="w-full"
                            onChange={(event): void => {
                                setFilters({ ...filters, keyword: event.target.value })
                            }}
                        />
                    </div>
                    {isQueryView ? null : (
                        <div className="flex items-center gap-1">
                            {isHighlightTab ? (
                                <>
                                    {ANNOTATION_COLORS.map((option) => (
                                        <Button
                                            key={option.value}
                                            variant={filters.color === option.value ? 'secondary' : 'ghost'}
                                            size="icon-xs"
                                            aria-label={`只看${option.label}划线`}
                                            onClick={(): void => {
                                                setFilters({
                                                    ...filters,
                                                    color: filters.color === option.value ? null : option.value,
                                                })
                                            }}
                                        >
                                            <span
                                                className="size-3 rounded-full"
                                                style={{ backgroundColor: option.css }}
                                            />
                                        </Button>
                                    ))}
                                </>
                            ) : null}
                        </div>
                    )}
                </AppMenu>
            </AppHeader>
            <AppContent isScrollable>
                {/* AI 解释与标注分属两张表：只在「查询」页签展示，不混进划线 / 批注的列表口径 */}
                {isQueryView ? (
                    <QueryRecordSection keyword={filters.keyword} />
                ) : (
                    <AnnotationListSection
                        items={items}
                        isLoading={isLoading}
                        error={error}
                        notice={notice}
                        hasMore={hasMore}
                        onReveal={handleReveal}
                        onUpdateColor={updateColor}
                        onRemove={remove}
                        onLoadMore={loadMore}
                    />
                )}
            </AppContent>
        </AppPage>
    )
}
