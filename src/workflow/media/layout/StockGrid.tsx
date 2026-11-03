/**
 * 在线图库搜索结果网格：两列卡片，点击即下载并插入，已下载过的图挂角标。
 * 复用约定：卡片外壳取 @components/ui 的 ItemGroup + Item（Item 一律在组内）、骨架取 skeleton，
 * 角标 / 遮罩 / 署名统一交给 StockPhotoOverlay，图片统一 aspect-4/3（侧栏宽度下两列最紧凑）；
 * 焦点环用负偏移 outline，避免被卡片的 overflow-hidden 裁掉；悬停复用 input / button 的聚焦视觉
 * （border-ring + ring-3 ring-ring/50）并叠 10% 黑色遮罩，遮罩只压暗图片，角标与操作按钮叠在其上。
 * 关键约束：卡片是原生 button，键盘回车与空格都能触发插入；
 * 缩略图缺失时显示占位并提供「重试」而不是空白卡——上游偶尔会拒掉单张图；
 * 有在途插入时其余卡片禁用，避免连点触发并发下载。
 */
import { cn } from 'cn'
import { ImageOff, RotateCw } from 'lucide-react'
import { Item, ItemGroup } from '@components/ui/item'
import { Skeleton } from '@components/ui/skeleton'
import type { StockPhoto } from '@shared/types/stock'
import { Button } from '@webview/components/Button'
import { Image } from '@webview/components/Image'
import { StockPhotoOverlay } from './StockPhotoOverlay'
import type { JSX } from 'react'

/** 首屏骨架卡数量：两列 × 三行，正好铺满一屏 */
const SKELETON_COUNT = 6

interface StockGridProps {
    items: StockPhoto[]
    /** 首屏加载：渲染骨架而不是空态 */
    isLoading: boolean
    /** 正在插入的图片标识：该卡转圈，其余卡禁用 */
    insertingId: string | null
    /** 上次插入失败的图片标识：显示「重试」提示 */
    failedId: string | null
    onInsert: (id: string) => void
    /** 补取缩略图：thumbUrl 为 null 时由卡片触发 */
    onRetryThumb: (id: string) => void
}

export function StockGrid({
    items,
    isLoading,
    insertingId,
    failedId,
    onInsert,
    onRetryThumb,
}: StockGridProps): JSX.Element {
    if (isLoading && items.length === 0) {
        return (
            <div className="grid grid-cols-2 gap-3">
                {Array.from({ length: SKELETON_COUNT }, (_, index) => (
                    <Skeleton key={`stock-skeleton-${String(index)}`} className="aspect-4/3 w-full rounded-lg" />
                ))}
            </div>
        )
    }

    return (
        <ItemGroup className="grid grid-cols-2 gap-3 pt-1">
            {items.map((photo) => {
                const isInserting = insertingId === photo.id
                const isDisabled = insertingId !== null && !isInserting
                const isFailed = failedId === photo.id
                return (
                    <Item
                        key={photo.id}
                        variant="outline"
                        size="xs"
                        className={cn(
                            'group relative overflow-hidden p-0 transition-[border-color,box-shadow] hover:border-ring hover:ring-3 hover:ring-ring/50',
                            isDisabled && 'pointer-events-none opacity-60',
                        )}
                    >
                        <button
                            type="button"
                            aria-label={`插入图片：${photo.alt.length > 0 ? photo.alt : photo.id}`}
                            disabled={isDisabled || isInserting}
                            className="block w-full cursor-pointer outline-none focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2 disabled:cursor-default"
                            onClick={() => onInsert(photo.id)}
                        >
                            {photo.thumbUrl === null ? (
                                <span className="flex aspect-4/3 w-full items-center justify-center bg-muted">
                                    <ImageOff className="size-5 text-muted-foreground" />
                                </span>
                            ) : (
                                <Image
                                    src={photo.thumbUrl}
                                    alt={photo.alt}
                                    aspect="4/3"
                                    className="w-full bg-muted"
                                    loading="lazy"
                                />
                            )}
                        </button>
                        {/* 悬停遮罩：只压暗图片，角标、署名与操作按钮在其上 */}
                        <span
                            aria-hidden
                            className="pointer-events-none absolute inset-0 bg-black/10 opacity-0 transition-opacity group-hover:opacity-100"
                        />
                        <StockPhotoOverlay
                            photographer={photo.photographer}
                            cornerLabel={photo.downloaded ? '已下载' : undefined}
                            cornerVariant="secondary"
                            isInserting={isInserting}
                            isFailed={isFailed}
                        />
                        {photo.thumbUrl === null ? (
                            <Button
                                variant="secondary"
                                size="xs"
                                tooltip="重新获取缩略图"
                                aria-label="重新获取缩略图"
                                disabled={isDisabled || isInserting}
                                className="absolute right-1.5 bottom-1.5 opacity-80"
                                onClick={() => onRetryThumb(photo.id)}
                            >
                                <RotateCw className="size-3.5" />
                                重试
                            </Button>
                        ) : null}
                    </Item>
                )
            })}
        </ItemGroup>
    )
}
