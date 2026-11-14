/**
 * 标注总览页：跨文档查看所有划线与批注，支持类型筛选、失效筛选与关键词检索。
 * 复用约定：外壳取 AppPage，筛选栏取 layout/AnnotationFilterBar，列表取 layout/AnnotationListSection，
 * 查询记录取 layout/QueryRecordSection，数据与筛选状态分别编排在 ./hooks 下的三个 hook。
 * 关键约束：页面只留页头文案与三块区块的装配，不再自持筛选条件与跳转判定；
 * 「查询」只切视图、不下发到标注列表查询（列表 hook 的 isEnabled 依赖当前页签）；
 * 跳转失败必须给出可见提示——判定与文案在 ./reveal，页面只负责应用。
 */
'use client'

import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { toastError } from '@shared/utils/error'
import { AppAction, AppContent, AppDescription, AppHeader, AppPage, AppTitle } from '@webview/components/AppPage'
import { Button } from '@webview/components/Button'
import { useAnnotationFilterState } from './hooks/useAnnotationFilterState'
import { useAnnotationList } from './hooks/useAnnotationList'
import { useAnnotationStats } from './hooks/useAnnotationStats'
import { DEFAULT_ANNOTATION_KIND, DEFAULT_KIND_TAB } from './kindTab'
import { AnnotationFilterBar } from './layout/AnnotationFilterBar'
import { AnnotationListSection } from './layout/AnnotationListSection'
import { QueryRecordSection } from './layout/QueryRecordSection'
import { resolveRevealOutcome } from './reveal'
import type { KindTab } from './kindTab'
import type { JSX } from 'react'

export function WorkflowAnnotation(): JSX.Element {
    /** 当前选中的类型页签：列表 hook 的启用开关依赖它，故由页面持有 */
    const [activeKind, setActiveKind] = useState<KindTab>(DEFAULT_KIND_TAB)
    // 查询视图不查标注表：isEnabled 为假时列表请求整体挂起，回切再补拉首页
    const { items, isLoading, error, hasMore, filters, setFilters, loadMore, updateColor, remove, reveal } =
        useAnnotationList(DEFAULT_ANNOTATION_KIND, activeKind !== 'query')
    const { stats, refresh } = useAnnotationStats()
    const { isQueryView, isHighlightTab, hasActiveFilter, notice, setNotice, patchFilters, changeKind } =
        useAnnotationFilterState({ activeKind, onChangeKind: setActiveKind, filters, setFilters })

    /** 查询记录被删除：「查询 N」不归区块持有，转发到统计刷新即可 */
    const handleRecordsChange = useCallback((): void => {
        void refresh()
    }, [refresh])

    /** 稳定引用：列表区块按 memo 收敛重渲染，回调每渲染新建会让它整体失效 */
    const handleReveal = useCallback(
        async (id: string): Promise<void> => {
            try {
                const resolution = resolveRevealOutcome(await reveal(id))
                setNotice(resolution.notice)
                if (resolution.toastText !== null) {
                    toast.error(resolution.toastText)
                }
                if (resolution.shouldRefreshStats) {
                    void refresh()
                }
            } catch (cause) {
                // 宿主拒绝（如路径越界）同样要有回音，不能让点击毫无反应
                toastError(cause)
            }
        },
        [refresh, reveal, setNotice],
    )

    /** 删除后显式刷新统计：列表条数不再当作「数据已变更」的代理信号 */
    const handleRemove = useCallback(
        async (id: string): Promise<void> => {
            await remove(id)
            void refresh()
        },
        [refresh, remove],
    )

    return (
        <AppPage>
            <AppHeader>
                <AppTitle>标注</AppTitle>
                {/* 查询记录没有「失效」概念：查询视图下不渲染该按钮，免得点了列表毫无变化 */}
                {isQueryView ? null : (
                    <AppAction>
                        <Button
                            variant={filters.orphanedOnly ? 'default' : 'ghost'}
                            onClick={(): void => {
                                patchFilters({ orphanedOnly: !filters.orphanedOnly })
                            }}
                        >
                            仅看失效
                        </Button>
                    </AppAction>
                )}
                {stats === null ? null : (
                    <AppDescription>
                        共 {stats.total} 条 · 划线 {stats.highlights} · 批注 {stats.notes} · 查询 {stats.queries}
                        {stats.orphaned === 0 ? '' : ` · 失效 ${stats.orphaned}`}
                    </AppDescription>
                )}
                <AnnotationFilterBar
                    activeKind={activeKind}
                    isQueryView={isQueryView}
                    isHighlightTab={isHighlightTab}
                    color={filters.color}
                    keyword={filters.keyword}
                    onChangeKind={changeKind}
                    onChangeKeyword={(next): void => {
                        patchFilters({ keyword: next })
                    }}
                    onChangeColor={(next): void => {
                        patchFilters({ color: next })
                    }}
                />
            </AppHeader>
            <AppContent isScrollable>
                {/* AI 解释与标注分属两张表：只在「查询」页签展示，不混进划线 / 批注的列表口径 */}
                {isQueryView ? (
                    <QueryRecordSection keyword={filters.keyword} onRecordsChange={handleRecordsChange} />
                ) : (
                    <AnnotationListSection
                        items={items}
                        isLoading={isLoading}
                        error={error}
                        notice={notice}
                        hasActiveFilter={hasActiveFilter}
                        hasMore={hasMore}
                        onReveal={handleReveal}
                        onUpdateColor={updateColor}
                        onRemove={handleRemove}
                        onLoadMore={loadMore}
                    />
                )}
            </AppContent>
        </AppPage>
    )
}
