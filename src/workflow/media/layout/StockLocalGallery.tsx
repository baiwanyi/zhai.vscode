/**
 * 在线图库「已下载」网格：按月分组、分批挂载，点击即插入，悬停可删除。
 * 复用约定：空态取 @webview/components/StateEmpty，骨架取 skeleton，图片取 @webview/components/Image，
 * 卡片容器取 @components/ui 的 ItemGroup + Item（每次操作块都包在组里），分组头与媒体页同一吸顶样式，
 * 分批口径同为每组各取 60 张，滚到底自动续放、不限页数（本地数据没有配额成本）；
 * 悬停复用 input / button 的聚焦视觉（border-ring + ring-3 ring-ring/50）并叠 10% 黑色遮罩，
 * 遮罩只压暗图片，角标与操作按钮叠在其上。
 * 关键约束：数据源是磁盘（宿主已对账），本组件不做过滤与去重；
 * 丢失的条目灰显且不可插入——点它只会得到一次下载失败；
 * 删除是破坏性操作，本组件只上报意图，二次确认由页面负责。
 */
import { ImageIcon, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Item, ItemGroup } from '@components/ui/item'
import { Skeleton } from '@components/ui/skeleton'
import type { StockLocalPhoto } from '@shared/types/stock'
import { Button } from '@webview/components/Button'
import { Image } from '@webview/components/Image'
import { StateEmpty } from '@webview/components/StateEmpty'
import { StockPhotoOverlay } from './StockPhotoOverlay'
import type { JSX } from 'react'
import { formatMediaMonth } from '../hooks/useImageFilters'

/** 每批挂载张数：与媒体页一致的节奏，避免一次渲染上千个节点 */
const PAGE_SIZE = 60

/** 分组头：与媒体页同一吸顶样式 */
const GROUP_HEADER_CLASS =
    'bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-10 px-4 py-2 text-xs font-medium text-muted-foreground backdrop-blur'

/** 按月分组后的结构 */
interface LocalGroup {
    month: string
    label: string
    items: StockLocalPhoto[]
}

/** 按月分组：入参已按路径倒序，分组顺序与组内顺序都沿用；标签复用媒体页的年月格式化 */
function groupByMonth(items: readonly StockLocalPhoto[]): LocalGroup[] {
    const groups: LocalGroup[] = []
    for (const item of items) {
        const last = groups[groups.length - 1]
        if (last !== undefined && last.month === item.month) {
            last.items.push(item)
            continue
        }
        groups.push({ month: item.month, label: formatMediaMonth(item.month), items: [item] })
    }
    return groups
}

interface StockLocalGalleryProps {
    items: StockLocalPhoto[]
    isLoading: boolean
    /** 正在插入的图片标识 */
    insertingId: string | null
    /** 上次插入失败的图片标识 */
    failedId: string | null
    onInsert: (id: string) => void
    onDelete: (photo: StockLocalPhoto) => void
}

export function StockLocalGallery({
    items,
    isLoading,
    insertingId,
    failedId,
    onInsert,
    onDelete,
}: StockLocalGalleryProps): JSX.Element {
    const [limit, setLimit] = useState(PAGE_SIZE)
    /** 自动加载哨兵：进入视口即追加一批，已下载是本地数据，不限页数 */
    const sentinelRef = useRef<HTMLDivElement | null>(null)

    /**
     * 哨兵观察：进视口（提前 300px）就再放一批；limit 与条目数变化时重建观察，
     * 一屏没填满会链式追加，直到填满或全部渲染完——不做页数封顶，本地数据没有配额成本。
     */
    useEffect(() => {
        const sentinel = sentinelRef.current
        if (sentinel === null) {
            return
        }
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    setLimit((value) => value + PAGE_SIZE)
                }
            },
            { rootMargin: '300px 0px' },
        )
        observer.observe(sentinel)
        return (): void => {
            observer.disconnect()
        }
    }, [items.length, limit])

    if (isLoading && items.length === 0) {
        return (
            <div className="grid grid-cols-2 gap-3">
                {Array.from({ length: 6 }, (_, index) => (
                    <Skeleton key={`local-skeleton-${String(index)}`} className="aspect-4/3 w-full rounded-lg" />
                ))}
            </div>
        )
    }

    if (items.length === 0) {
        return (
            <StateEmpty
                title="还没有下载过图片"
                description="切到「搜索」找一张，插入后就会出现在这里，之后再用不需要联网。"
                icon={ImageIcon}
                className="flex-1 justify-center"
            />
        )
    }

    const groups = groupByMonth(items)
    const visible = groups
        .map((group) => ({
            month: group.month,
            label: group.label,
            total: group.items.length,
            items: group.items.slice(0, limit),
        }))
        .filter((group) => group.items.length > 0)
    const rendered = visible.reduce((sum, group) => sum + group.items.length, 0)

    return (
        <div className="mb-3">
            {visible.map((group) => (
                <section key={group.month} aria-label={group.label}>
                    <div className={GROUP_HEADER_CLASS}>
                        {group.label}
                        <span className="ml-1.5 tabular-nums">· {group.total} 张</span>
                    </div>
                    <ItemGroup className="grid grid-cols-2 gap-3 pt-2">
                        {group.items.map((photo) => {
                            const isInserting = insertingId === photo.id
                            const isDisabled = photo.missing || (insertingId !== null && !isInserting)
                            return (
                                <Item
                                    key={photo.id}
                                    variant="outline"
                                    size="xs"
                                    className="group relative overflow-hidden p-0 transition-[border-color,box-shadow] hover:border-ring hover:ring-3 hover:ring-ring/50 data-[missing=true]:opacity-50"
                                    data-missing={photo.missing}
                                >
                                    <button
                                        type="button"
                                        aria-label={`插入图片：${photo.alt.length > 0 ? photo.alt : photo.id}`}
                                        disabled={isDisabled}
                                        className="block w-full cursor-pointer outline-none focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2 disabled:cursor-default"
                                        onClick={() => onInsert(photo.id)}
                                    >
                                        <Image
                                            src={photo.url}
                                            alt={photo.alt.length > 0 ? photo.alt : photo.id}
                                            aspect="4/3"
                                            className="w-full bg-muted"
                                            loading="lazy"
                                        />
                                    </button>
                                    {/* 悬停遮罩：只压暗图片，角标、署名与操作按钮在其上 */}
                                    <span
                                        aria-hidden
                                        className="pointer-events-none absolute inset-0 bg-black/20 opacity-0 transition-opacity group-hover:opacity-100"
                                    />
                                    <StockPhotoOverlay
                                        photographer={photo.photographer}
                                        cornerLabel={photo.missing ? '已丢失' : undefined}
                                        isInserting={isInserting}
                                        isFailed={failedId === photo.id}
                                    />
                                    <Button
                                        variant="destructive"
                                        size="icon-sm"
                                        aria-label="删除这张图片"
                                        disabled={insertingId !== null}
                                        className="absolute right-1.5 bottom-1.5 opacity-0 transition-opacity group-focus-within:opacity-80 group-hover:opacity-80"
                                        onClick={(event) => {
                                            event.stopPropagation()
                                            onDelete(photo)
                                        }}
                                    >
                                        <Trash2 className="size-3.5" />
                                    </Button>
                                </Item>
                            )
                        })}
                    </ItemGroup>
                </section>
            ))}
            {/* 自动加载哨兵：不可见占位，滚到底部附近即续放下一批 */}
            {rendered < items.length ? <div ref={sentinelRef} className="h-px" aria-hidden /> : null}
        </div>
    )
}
