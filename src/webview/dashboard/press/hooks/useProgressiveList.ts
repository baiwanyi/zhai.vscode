/**
 * 分批渲染：按总数计算当前可见条数，底部哨兵进入可视区即自动追加一批，另保留手动加载兜底。
 * 关键约束：观察器 root 必须取最近的 ScrollArea 视口——webview 中滚动发生在该容器内而 body 不滚动，
 * 用默认视口会导致一次性全部触发或永不触发；折叠中的卷传 isActive=false，此时不挂观察器，
 * 展开后由 isActive 变化重新建立；数据量缩小（重拉后条目变少）时以 total 收敛，避免渲染越界。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

/** 默认每批条数：单卷章节较多时首屏只渲染 100 条 */
export const DEFAULT_PAGE_SIZE = 100

/** 滚动容器标记：由 components/ui/scroll-area 的视口节点提供 */
const SCROLL_VIEWPORT_SELECTOR = '[data-slot="scroll-area-viewport"]'

/** 哨兵提前量：距底部 160px 即预加载下一批，减少滚动中的空窗 */
const SENTINEL_MARGIN = '160px'

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
    const sentinelRef = useRef<HTMLDivElement | null>(null)
    const upperBound = Math.max(total, pageSize)
    const effectiveCount = Math.min(visibleCount, upperBound)
    const hasMore = effectiveCount < total

    const loadMore = useCallback((): void => {
        setVisibleCount((previous) => Math.min(previous + pageSize, upperBound))
    }, [pageSize, upperBound])

    useEffect(() => {
        const sentinel = sentinelRef.current
        if (sentinel === null || !hasMore || !isActive) {
            return
        }
        const viewport = sentinel.closest(SCROLL_VIEWPORT_SELECTOR)
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    loadMore()
                }
            },
            { root: viewport instanceof Element ? viewport : null, rootMargin: SENTINEL_MARGIN },
        )
        observer.observe(sentinel)
        return (): void => {
            observer.disconnect()
        }
    }, [hasMore, isActive, loadMore])

    return { visibleCount: effectiveCount, hasMore, loadMore, sentinelRef }
}
