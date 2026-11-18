/**
 * 滚动哨兵：滚动容器接近底部时上报一次续载意图，卸载或依赖变化时自动解绑观察器。
 * 复用约定：观察器 root 默认取最近的 ScrollArea 视口——webview 里滚动发生在该容器内、body 不滚动，
 * 用浏览器默认视口会一次性全触发或永不触发；提前量由调用方按列表密度给出。
 * 视口选择器取 @shared/utils/scrollArea，与底栏遮罩联动等逻辑共用同一份，避免两套口径漂移。
 * 关键约束：hasMore 为假时不挂观察器，避免一屏没填满时反复触发空请求；
 * 条目数等外部信号经 observeKey 传入，变化时重建观察才能链式补载；
 * onLoadMore 必须是稳定引用（useCallback），否则每次渲染都会重建观察器。
 */
import { useEffect, useRef } from 'react'
import { SCROLL_VIEWPORT_SELECTOR } from '@shared/utils/scrollArea'
import type { RefObject } from 'react'

/** 默认提前量：距底部 160px 即预载下一页，减少滚动中的空窗 */
const DEFAULT_ROOT_MARGIN = '160px'

export interface ScrollSentinelOptions {
    /** 是否还有下一页：为假时不挂观察器，哨兵 ref 仍可安全挂载 */
    hasMore: boolean
    /** 续载回调：须为稳定引用；允许返回 Promise，哨兵只上报意图、不等待结果 */
    onLoadMore: () => void | Promise<void>
    /** 距底部提前量，缺省 160px */
    rootMargin?: string
    /** 外部信号（一般为已渲染条目数）：变化时重建观察，首屏未填满才能链式补载 */
    observeKey?: number
    /** 是否激活：折叠中的区域传 false，展开后由该值变化重建 */
    isActive?: boolean
}

export function useScrollSentinel({
    hasMore,
    onLoadMore,
    rootMargin = DEFAULT_ROOT_MARGIN,
    observeKey = 0,
    isActive = true,
}: ScrollSentinelOptions): RefObject<HTMLDivElement | null> {
    const sentinelRef = useRef<HTMLDivElement | null>(null)

    useEffect(() => {
        const sentinel = sentinelRef.current
        if (!hasMore || !isActive || sentinel === null) {
            return
        }
        const viewport = sentinel.closest(SCROLL_VIEWPORT_SELECTOR)
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    // 只上报意图：不等待结果，续载失败也不该中断观察
                    void onLoadMore()
                }
            },
            { root: viewport instanceof Element ? viewport : null, rootMargin },
        )
        observer.observe(sentinel)
        return (): void => {
            observer.disconnect()
        }
    }, [hasMore, isActive, observeKey, onLoadMore, rootMargin])

    return sentinelRef
}
