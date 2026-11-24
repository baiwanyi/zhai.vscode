/**
 * 图片列表续载入口：按钮与滚动哨兵两种形态，只上报加载意图、不发起任何请求。
 * 复用约定：按钮取 @webview/components/Button；哨兵与观察器交给 LoadMoreSentinel + useScrollSentinel
 * （root 取最近的 ScrollArea 视口、距底部 300px 提前触发），转圈由哨兵组件统一呈现。
 * 关键约束：按钮分母取筛选结果总数、分子取已渲染数，两者相等时不渲染入口；
 * 哨兵在没有更多条目时不渲染也不观察，避免一屏没填满时反复触发空请求。
 */
import { LoadMoreSentinel } from '@webview/blocks/LoadMoreSentinel'
import { Button } from '@webview/components/Button'
import { useScrollSentinel } from '@webview/hooks/useScrollSentinel'
import type { ImageListPaging } from './imageListModel'
import type { JSX } from 'react'

/** 卡片密度低于文字列表，提前量放宽到 300px，滚动中不出现空窗 */
const IMAGE_SENTINEL_MARGIN = '300px'

/** none 模式下的占位回调：此时 isActive 为假、观察器不会挂载，只为满足 hook 的必填签名 */
const NOOP = (): void => {}

interface ImageListLoadMoreProps {
    paging: ImageListPaging
    /** 已渲染条目数：变化时重建哨兵观察，保证一屏未填满时能链式补载 */
    observeKey?: number
}

export function ImageListLoadMore({ paging, observeKey = 0 }: ImageListLoadMoreProps): JSX.Element | null {
    const isSentinel = paging.mode === 'sentinel'
    const sentinelRef = useScrollSentinel({
        hasMore: paging.mode === 'sentinel' && paging.hasMore,
        onLoadMore: paging.mode === 'none' ? NOOP : paging.onLoadMore,
        rootMargin: IMAGE_SENTINEL_MARGIN,
        observeKey,
        isActive: isSentinel,
    })

    if (paging.mode === 'button') {
        if (paging.rendered >= paging.total) {
            return null
        }
        return (
            <div className="flex justify-center px-4 pb-4">
                <Button size="sm" variant="outline" onClick={paging.onLoadMore}>
                    加载更多（{paging.rendered} / {paging.total}）
                </Button>
            </div>
        )
    }

    if (!isSentinel || !paging.hasMore) {
        return null
    }

    return <LoadMoreSentinel sentinelRef={sentinelRef} isLoading={paging.isLoadingMore} />
}
