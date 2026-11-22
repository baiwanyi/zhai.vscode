/**
 * 卡片内配图预览：点击宫格后就地展开，宽度与卡片内容区一致、高度按图片比例自适应，不跳新页面也不开浮层。
 * 复用约定：多图走 @components/ui/carousel（embla），从被点的那张开始；图直接用宫格那张展示图
 * （长边 960，见 normalizeTimelinePost 的 large 档），与宫格共用 useWeiboImage 的模块级缓存，
 * 展开即命中、不再为预览单独拉原图；尺寸只用于算框比例与占位，与实际加载的档位无关。
 * 关键约束：每张按自己的比例撑开高度（切横图变矮、切回竖图再长回去），图片 contain 居中不裁剪；
 * 多图时左右各留四分之一热区：点击切换上/下一张，鼠标移上去才浮出箭头，到两端不响应也不浮出；
 * 中间区域点击收起预览回到宫格，Esc 同样收起。
 */
import { cn } from 'cn'
import { ChevronLeft, ChevronRight, ImageOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Carousel, CarouselContent, CarouselItem, useCarousel } from '@components/ui/carousel'
import type { CarouselApi } from '@components/ui/carousel'
import { Spinner } from '@components/ui/spinner'
import type { WeiboTimelineImageSize } from '@shared/types/weibo'
import type { JSX } from 'react'
import { useWeiboImage } from '../hooks/useWeiboImage'

/** 左右切换热区宽度：各占四分之一，中间一半留给「点击收起」 */
const SWITCH_ZONE_CLASS = 'group absolute inset-y-0 z-10 flex w-1/4 items-center'

/** 热区箭头：默认透明，鼠标移到热区才浮出；到端点时始终不显示 */
const SWITCH_ARROW_CLASS =
    'flex size-8 items-center justify-center rounded-full bg-black/45 text-white transition-opacity duration-200'

/** 预览项：展示图与宫格同源，尺寸只作框比例与占位 */
export interface WeiboMediaPreviewItem {
    thumbUrl: string
    size: WeiboTimelineImageSize | null
}

interface WeiboMediaPreviewProps {
    items: WeiboMediaPreviewItem[]
    /** 起始位置：点宫格里第几张就从第几张开始浏览 */
    startIndex: number
    /** 再次点击图片：收起预览，回到宫格 */
    onClose: () => void
}

interface PreviewSlideProps {
    item: WeiboMediaPreviewItem
    /** 多图才有左右热区；单图整片区域都归「点击收起」 */
    hasSiblings: boolean
    onClose: () => void
}

/**
 * 单张幻灯片：每张按自己的比例撑开高度，切到横图就跟着缩、切回竖图再长回去；
 * 点击中间收起，点击左右热区翻页。
 */
function PreviewSlide({ item, hasSiblings, onClose }: PreviewSlideProps): JSX.Element {
    const image = useWeiboImage(item.thumbUrl)
    const { scrollPrev, scrollNext, canScrollPrev, canScrollNext } = useCarousel()
    const size = item.size
    // 有尺寸才按比例撑开；缺尺寸时不设框，直接让图片按自然高度落位
    const frameStyle =
        size === null || size.width <= 0 || size.height <= 0
            ? undefined
            : { aspectRatio: `${String(size.width)} / ${String(size.height)}` }

    return (
        <div className="relative">
            <button
                type="button"
                onClick={onClose}
                aria-label="收起预览，回到宫格"
                className="block w-full cursor-zoom-out"
            >
                <span
                    className={cn(
                        'flex w-full items-center justify-center overflow-hidden rounded-lg bg-muted',
                        frameStyle === undefined && 'min-h-40',
                    )}
                    style={frameStyle}
                >
                    {image.isFailed ? (
                        <ImageOff className="size-5 text-muted-foreground" aria-hidden="true" />
                    ) : image.localUrl === null ? (
                        <Spinner className="size-6 text-muted-foreground" />
                    ) : (
                        <img
                            src={image.localUrl}
                            alt="微博配图"
                            className={cn(frameStyle === undefined ? 'h-auto w-full' : 'size-full object-contain')}
                        />
                    )}
                </span>
            </button>

            {hasSiblings ? (
                <>
                    <button
                        type="button"
                        onClick={() => {
                            if (canScrollPrev) {
                                scrollPrev()
                            }
                        }}
                        aria-label="上一张"
                        className={cn(SWITCH_ZONE_CLASS, 'left-0 cursor-pointer justify-start pl-2')}
                    >
                        <span
                            className={cn(
                                SWITCH_ARROW_CLASS,
                                canScrollPrev ? 'opacity-0 group-hover:opacity-100' : 'opacity-0',
                            )}
                        >
                            <ChevronLeft className="size-5" aria-hidden="true" />
                        </span>
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            if (canScrollNext) {
                                scrollNext()
                            }
                        }}
                        aria-label="下一张"
                        className={cn(SWITCH_ZONE_CLASS, 'right-0 cursor-pointer justify-end pr-2')}
                    >
                        <span
                            className={cn(
                                SWITCH_ARROW_CLASS,
                                canScrollNext ? 'opacity-0 group-hover:opacity-100' : 'opacity-0',
                            )}
                        >
                            <ChevronRight className="size-5" aria-hidden="true" />
                        </span>
                    </button>
                </>
            ) : null}
        </div>
    )
}

export function WeiboMediaPreview({ items, startIndex, onClose }: WeiboMediaPreviewProps): JSX.Element {
    /** 起点钳制在合法范围：越界的 startIndex 会让 embla 落到空白页，且不抛错、很难发现 */
    const safeStartIndex = Math.min(Math.max(startIndex, 0), Math.max(items.length - 1, 0))
    const [api, setApi] = useState<CarouselApi>(undefined)
    const [currentIndex, setCurrentIndex] = useState(safeStartIndex)

    /** 跟随 embla 的选中项：右下角的「当前 / 总数」随之更新 */
    useEffect(() => {
        if (api === undefined) {
            return
        }
        const handleSelect = (): void => {
            setCurrentIndex(api.selectedScrollSnap())
        }
        api.on('select', handleSelect)
        api.on('reInit', handleSelect)
        return (): void => {
            api.off('select', handleSelect)
            api.off('reInit', handleSelect)
        }
    }, [api])

    /**
     * 键盘：Esc 收起、左右方向键翻页。
     * 关键约束：方向键是左右热区的键盘等价物——只靠点击的话，键盘用户打开预览后无法换图。
     */
    useEffect(() => {
        if (api === undefined) {
            return
        }
        const handleKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                onClose()
                return
            }
            if (event.key === 'ArrowLeft') {
                event.preventDefault()
                api.scrollPrev()
                return
            }
            if (event.key === 'ArrowRight') {
                event.preventDefault()
                api.scrollNext()
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return (): void => {
            window.removeEventListener('keydown', handleKeyDown)
        }
    }, [api, onClose])

    const hasMultiple = items.length > 1

    /**
     * 外框高度跟着「当前这张」的比例走：切到横图就缩、切回竖图再长。
     * 关键约束：embla 的幻灯片是同一行 flex，行高由最高的那张决定——不把根节点高度按当前项钉住，
     * 组里只要有一张长竖图，切到横图时下方就会留一大片空白。故这里用当前项的宽高比撑开根节点，
     * 并让根裁掉溢出的其余幻灯片（配合 CarouselContent 的 items-start，避免各项被拉齐到最高）。
     */
    const currentSize = items[currentIndex]?.size ?? null
    const frameStyle =
        currentSize === null || currentSize.width <= 0 || currentSize.height <= 0
            ? undefined
            : { aspectRatio: `${String(currentSize.width)} / ${String(currentSize.height)}` }

    return (
        <Carousel
            opts={{ startIndex: safeStartIndex, containScroll: 'trimSnaps' }}
            setApi={setApi}
            className="w-full overflow-hidden"
            style={frameStyle}
        >
            {/* 宫格展开处不留缝：清掉 shadcn 默认的 -ml-4 / pl-4 间距，切换时图片紧贴两侧 */}
            <CarouselContent className="ml-0 items-start">
                {items.map((item) => (
                    <CarouselItem key={item.thumbUrl} className="pl-0">
                        <PreviewSlide item={item} hasSiblings={hasMultiple} onClose={onClose} />
                    </CarouselItem>
                ))}
            </CarouselContent>
            {hasMultiple ? (
                <span className="pointer-events-none absolute right-2 bottom-2 z-20 rounded bg-black/55 px-1.5 py-0.5 font-mono text-[0.6rem] text-white leading-tight">
                    {currentIndex + 1} / {items.length}
                </span>
            ) : null}
        </Carousel>
    )
}
