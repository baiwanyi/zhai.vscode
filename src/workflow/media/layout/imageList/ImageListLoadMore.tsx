/**
 * 图片列表续载入口：按钮与滚动哨兵两种形态，只上报加载意图、不发起任何请求。
 * 复用约定：按钮取 @webview/components/Button，转圈取 @components/ui/spinner；
 * 哨兵用 IntersectionObserver 提前 300px 触发，条目数变化时重建观察并在卸载时解绑。
 * 关键约束：按钮分母取筛选结果总数、分子取已渲染数，两者相等时不渲染入口；
 * 哨兵在没有更多条目时不渲染也不观察，避免一屏没填满时反复触发空请求。
 */
import { useEffect, useRef } from 'react'
import { Spinner } from '@components/ui/spinner'
import { Button } from '@webview/components/Button'
import type { ImageListPaging } from './imageListModel'
import type { JSX } from 'react'

interface ImageListLoadMoreProps {
    paging: ImageListPaging
    /** 已渲染条目数：变化时重建哨兵观察，保证一屏未填满时能链式补载 */
    observeKey?: number
}

export function ImageListLoadMore({ paging, observeKey = 0 }: ImageListLoadMoreProps): JSX.Element | null {
    const sentinelRef = useRef<HTMLDivElement | null>(null)
    const isSentinel = paging.mode === 'sentinel'
    const hasMore = isSentinel && paging.hasMore
    const onLoadMore = paging.mode === 'none' ? null : paging.onLoadMore

    useEffect(() => {
        const sentinel = sentinelRef.current
        if (!isSentinel || !hasMore || sentinel === null || onLoadMore === null) {
            return
        }
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    onLoadMore()
                }
            },
            { rootMargin: '300px 0px' },
        )
        observer.observe(sentinel)
        return (): void => {
            observer.disconnect()
        }
    }, [hasMore, isSentinel, observeKey, onLoadMore])

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

    if (!isSentinel || !hasMore) {
        return null
    }

    return (
        <div ref={sentinelRef} className="flex justify-center py-3">
            <Spinner className={paging.isLoadingMore ? 'size-4 text-muted-foreground' : 'invisible'} />
        </div>
    )
}
