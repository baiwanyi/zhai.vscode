/**
 * 在线图库搜索结果区：结果网格 + 空态与滚动自动加载。
 * 复用约定：搜索状态由页面持有的 useStockPhotos 注入（页头筛选行、话题标签行与本区共用同一份），
 * 插入动作由页面持有并透传，本组件不自己发 stock/insert；
 * 空态取 @webview/components/StateEmpty，骨架与卡片交给 StockGrid。
 * 关键约束：未配置密钥时先给引导空态——不能让人点了才看到「没有密钥」；
 * 冷却与限流错误以空态正文呈现，用户能读到「多久后恢复」而不是一行 toast 就消失；
 * 筛选行（StockFilterBar）在页头 AppMenu 里，本组件只负责结果区；
 * 列表滚动到底自动续载（页数上限在 useStockPhotos 里封顶），没有「加载更多」按钮——
 * 哨兵元素每次 items 变化都重建观察，一屏没填满时会链式补载到填满或触顶。
 */
import { ImageOff, KeyRound, Search } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Spinner } from '@components/ui/spinner'
import { Button } from '@webview/components/Button'
import { StateEmpty } from '@webview/components/StateEmpty'
import { StockGrid } from './StockGrid'
import type { UseStockPhotosResult } from '../hooks/useStockPhotos'
import type { JSX } from 'react'

interface StockResultPanelProps {
    /** 密钥是否已配置：未配置时整页给引导，不发任何请求 */
    isConfigured: boolean
    /** 搜索状态：页面持有一份，话题标签行与本区共用 */
    photos: UseStockPhotosResult
    onOpenKey: () => void
    /** 插入中的图片标识：由页面级 hook 持有，两个 tab 共用 */
    insertingId: string | null
    /** 上次插入失败的图片标识 */
    failedId: string | null
    onInsert: (id: string) => void
}

export function StockResultPanel({
    isConfigured,
    photos,
    onOpenKey,
    insertingId,
    failedId,
    onInsert,
}: StockResultPanelProps): JSX.Element {
    const {
        items,
        topic,
        isLoadingFirst,
        isLoadingMore,
        hasMore,
        errorText,
        loadMore,
        reload,
        retryThumb,
    } = photos

    /** 自动加载哨兵：进入视口（提前 300px）即续载下一页 */
    const sentinelRef = useRef<HTMLDivElement | null>(null)

    useEffect(() => {
        const sentinel = sentinelRef.current
        if (sentinel === null || !hasMore) {
            return
        }
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    loadMore()
                }
            },
            { rootMargin: '300px 0px' },
        )
        observer.observe(sentinel)
        return (): void => {
            observer.disconnect()
        }
    }, [hasMore, loadMore, items.length])

    if (!isConfigured) {
        return (
            <StateEmpty
                title="还没有配置 Unsplash"
                description="填写 Access Key 后即可搜索图库。图片会下载到文档保存目录的 unsplash 目录，之后可离线复用。"
                icon={KeyRound}
                className="flex-1 justify-center"
            >
                <Button onClick={onOpenKey}>配置密钥</Button>
            </StateEmpty>
        )
    }

    return (
        <div className="flex flex-col gap-2">
            {errorText !== null ? (
                <StateEmpty
                    title="没能取到图片"
                    description={errorText}
                    icon={ImageOff}
                    className="py-8"
                >
                    <Button variant="outline" onClick={reload}>
                        重试
                    </Button>
                </StateEmpty>
            ) : items.length === 0 && !isLoadingFirst ? (
                <StateEmpty
                    title="没有匹配的图片"
                    description={
                        topic === null
                            ? '换个关键词试试，Unsplash 以英文内容为主。'
                            : '这个话题下暂时没有图片，换个话题或直接搜索试试。'
                    }
                    icon={Search}
                    className="py-8"
                />
            ) : (
                <StockGrid
                    items={items}
                    isLoading={isLoadingFirst}
                    insertingId={insertingId}
                    failedId={failedId}
                    onInsert={onInsert}
                    onRetryThumb={retryThumb}
                />
            )}
            {/* 自动加载哨兵：加载中才显示转圈，其余时间透明占位继续观察 */}
            {hasMore ? (
                <div ref={sentinelRef} className="flex justify-center py-3">
                    <Spinner className={isLoadingMore ? 'size-4 text-muted-foreground' : 'invisible'} />
                </div>
            ) : null}
        </div>
    )
}
