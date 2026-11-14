/**
 * 分批渲染：按总数计算当前可见条数，底部哨兵进入可视区即自动追加一批，另保留手动加载兜底。
 * 复用约定：观察器与解绑交给 @webview/hooks/useScrollSentinel（root 取最近的 ScrollArea 视口、
 * 距底部 160px），本 hook 只维护已展开数量，哨兵 DOM 由 LoadMoreSentinel 承担。
 * 关键约束：折叠中的卷传 isActive=false，此时不挂观察器，展开后由该值变化重新建立；
 * 数据量缩小（重拉后条目变少）时以 total 收敛，避免渲染越界；
 * 观察信号取已渲染条数，一屏未填满时才能链式补载。
 */
import { useCallback, useState } from 'react'
import { useScrollSentinel } from '@webview/hooks/useScrollSentinel'
import type { RefObject } from 'react'

/** 默认每批条数：单卷章节较多时首屏只渲染 100 条 */
export const DEFAULT_PAGE_SIZE = 100

export interface ProgressiveListOptions {
    /** 每批条数，缺省 100 */
    pageSize?: number
    /** 是否处于激活态（如卷已展开），为 false 时不挂观察器 */
    isActive?: boolean
}

export interface ProgressiveListState {
    visibleCount: number
    hasMore: boolean
    loadMore: () => void
    sentinelRef: RefObject<HTMLDivElement | null>
}

export function useProgressiveList(total: number, options: ProgressiveListOptions = {}): ProgressiveListState {
    const { pageSize = DEFAULT_PAGE_SIZE, isActive = true } = options
    const [visibleCount, setVisibleCount] = useState(pageSize)
    const upperBound = Math.max(total, pageSize)
    const effectiveCount = Math.min(visibleCount, upperBound)
    const hasMore = effectiveCount < total

    const loadMore = useCallback((): void => {
        setVisibleCount((previous) => Math.min(previous + pageSize, upperBound))
    }, [pageSize, upperBound])

    const sentinelRef = useScrollSentinel({
        hasMore,
        onLoadMore: loadMore,
        observeKey: effectiveCount,
        isActive,
    })

    return { visibleCount: effectiveCount, hasMore, loadMore, sentinelRef }
}
