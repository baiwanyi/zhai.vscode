/**
 * 标注总览的筛选粘合：页签切换、颜色条件清理、跳转提示复位与空态判定都收在这里。
 * 复用约定：页签定义取 ../kindTab，筛选类型取 ./useAnnotationList；
 * filters 的权威仍在 useAnnotationList，本层只做写入包装，不改其对外契约。
 * 关键约束：颜色只有划线才有，切到批注或查询时连条件一起清空，避免留下看不见的筛选；
 * 条件一变旧提示即作废——提示描述的是某一次跳转结果，留着会指向已不适用的一次操作；
 * 页签由页面持有（列表 hook 的启用开关依赖它），本层只经 onChangeKind 回写。
 */
import { useState } from 'react'
import type { KindTab } from '../kindTab'
import type { AnnotationFilters } from './useAnnotationList'
import { toAnnotationKind } from '../kindTab'

export interface AnnotationFilterStateParams {
    /** 当前页签：页面持有，本层只读 */
    activeKind: KindTab
    /** 回写页签：与筛选条件在同一批次更新，避免页签与结果错位 */
    onChangeKind: (next: KindTab) => void
    /** 当前筛选条件：权威在 useAnnotationList */
    filters: AnnotationFilters
    /** 筛选写入：同样来自 useAnnotationList */
    setFilters: (next: AnnotationFilters) => void
}

export interface AnnotationFilterStateResult {
    isQueryView: boolean
    isHighlightTab: boolean
    /** 是否有生效筛选：列表空态据此区分「没有标注」与「被筛空」 */
    hasActiveFilter: boolean
    /** 跳转结果提示：条件变化时由本层复位 */
    notice: string | null
    setNotice: (next: string | null) => void
    patchFilters: (patch: Partial<AnnotationFilters>) => void
    changeKind: (next: KindTab) => void
}

export function useAnnotationFilterState({
    activeKind,
    onChangeKind,
    filters,
    setFilters,
}: AnnotationFilterStateParams): AnnotationFilterStateResult {
    const [notice, setNotice] = useState<string | null>(null)
    const isQueryView = activeKind === 'query'
    const isHighlightTab = activeKind === 'highlight'
    const hasActiveFilter =
        activeKind !== 'highlight' ||
        filters.color !== null ||
        filters.docPath !== null ||
        filters.orphanedOnly ||
        filters.keyword.trim().length > 0

    /**
     * 筛选写入收口：条件一变，上一次跳转的提示就作废——提示描述的是某一次跳转结果，
     * 留着会指向已不适用的一次操作。
     */
    const patchFilters = (patch: Partial<AnnotationFilters>): void => {
        setNotice(null)
        setFilters({ ...filters, ...patch })
    }

    /** 切页签：颜色只有划线才有，切到批注或查询时一并清掉，避免留下看不见的条件 */
    const changeKind = (next: KindTab): void => {
        onChangeKind(next)
        patchFilters({ kind: toAnnotationKind(next), color: next === 'highlight' ? filters.color : null })
    }

    return { isQueryView, isHighlightTab, hasActiveFilter, notice, setNotice, patchFilters, changeKind }
}
