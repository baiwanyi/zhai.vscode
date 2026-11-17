/**
 * 统一图片卡片：栅格内的缩略图、角标、说明、右下角悬停动作、多选勾选与在途/丢失态。
 * 复用约定：外壳取 @components/ui 的 Item（须置于 ItemGroup 内），图片取 @webview/components/Image，
 * 按钮取 @webview/components/Button，叠层交给 ImageCardOverlay；领域对象经 item.source 原样回传。
 * 关键约束：卡片主动作是原生 button，键盘回车与空格都能触发；内部操作按钮阻止冒泡，
 * 避免同时触发主动作；焦点环用负偏移 outline，防止被卡片的 overflow-hidden 裁掉；
 * 悬停动作统一排在右下角竖列、多选下整列隐藏；图片解码后回报原始像素，供上传页展示尺寸；
 * 缺图与非图片文件走图标占位而非空白卡，多选模式下隐藏右上徽标与悬停动作。
 */
import { cn } from 'cn'
import { Check } from 'lucide-react'
import { Item } from '@components/ui/item'
import { Button } from '@webview/components/Button'
import { Image } from '@webview/components/Image'
import { ImageCardOverlay } from './ImageCardOverlay'
import { IMAGE_LIST_ASPECT_CLASS } from './imageListModel'
import type { ImageListAction, ImageListAspect, ImageListItem } from './imageListModel'
import type { JSX, SyntheticEvent } from 'react'

interface ImageCardProps<T> {
    item: ImageListItem<T>
    aspect: ImageListAspect
    captionPlacement: 'overlay' | 'below' | 'none'
    dimOnHover: 'none' | 'light' | 'strong'
    isSelecting: boolean
    isSelected: boolean
    actions?: readonly ImageListAction<T>[]
    onActivate?: (item: ImageListItem<T>) => void
    onToggleSelect?: (item: ImageListItem<T>) => void
}

export function ImageCard<T>({
    item,
    aspect,
    captionPlacement,
    dimOnHover,
    isSelecting,
    isSelected,
    actions = [],
    onActivate,
    onToggleSelect,
}: ImageCardProps<T>): JSX.Element {
    const visibleActions = actions.filter((action) => action.isVisible?.(item) ?? true)
    const FallbackIcon = item.fallback?.icon
    const isDisabled = item.isDisabled === true || item.isBusy === true
    const activateLabel = isSelecting ? `选择：${item.alt}` : (item.activateLabel ?? item.alt)

    function handleActivate(): void {
        if (isSelecting) {
            onToggleSelect?.(item)
            return
        }
        onActivate?.(item)
    }

    /** 解码完成回传原始像素：宽高为 0 时不回报，避免把占位图当成真实尺寸 */
    function handleImageLoad(event: SyntheticEvent<HTMLImageElement>): void {
        const { naturalWidth, naturalHeight } = event.currentTarget
        if (naturalWidth <= 0 || naturalHeight <= 0) {
            return
        }
        item.onMeasured?.(naturalWidth, naturalHeight)
    }

    return (
        <Item
            variant="outline"
            size="xs"
            className={cn(
                'group relative overflow-hidden p-0 transition-[border-color,box-shadow] hover:border-ring hover:ring-3 hover:ring-ring/50',
                item.state === 'missing' && 'opacity-50',
                item.isDisabled === true && 'pointer-events-none opacity-60',
                isSelected && 'ring-2 ring-primary',
            )}
        >
            <button
                type="button"
                aria-label={activateLabel}
                disabled={isDisabled}
                className="block w-full cursor-pointer text-left outline-none focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2 disabled:cursor-default"
                onClick={handleActivate}
            >
                {item.src === null ? (
                    <span
                        className={cn(
                            'flex w-full flex-col items-center justify-center gap-1 bg-muted text-muted-foreground',
                            IMAGE_LIST_ASPECT_CLASS[aspect],
                        )}
                    >
                        {FallbackIcon === undefined ? null : <FallbackIcon className="size-6" />}
                        {item.fallback?.label === undefined ? null : (
                            <span className="text-xs uppercase">{item.fallback.label}</span>
                        )}
                    </span>
                ) : (
                    <Image
                        src={item.src}
                        alt={item.alt}
                        aspect={aspect}
                        className="w-full bg-muted"
                        loading="lazy"
                        onLoad={handleImageLoad}
                    />
                )}
                {captionPlacement === 'below' ? (
                    <>
                        <span className="block truncate px-2 pt-1.5 text-xs">{item.title}</span>
                        {item.meta === undefined ? null : (
                            <span className="block px-2 pb-1.5 text-muted-foreground text-xs tabular-nums">
                                {item.meta}
                            </span>
                        )}
                    </>
                ) : null}
            </button>

            {dimOnHover === 'none' ? null : (
                <span
                    aria-hidden
                    className={cn(
                        'pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100',
                        dimOnHover === 'strong' ? 'bg-black/50' : 'bg-black/30',
                    )}
                />
            )}

            <ImageCardOverlay
                badges={item.badges}
                title={captionPlacement === 'overlay' ? item.title : undefined}
                isBusy={item.isBusy}
                isFailed={item.isFailed}
                showRightBadge={!isSelecting}
            />

            {isSelecting ? (
                <span
                    aria-hidden
                    className={cn(
                        'absolute top-2 right-2 flex size-5 items-center justify-center rounded-full border',
                        isSelected ? 'border-primary bg-primary text-primary-foreground' : 'bg-background/80',
                    )}
                >
                    {isSelected ? <Check className="size-3.5" /> : null}
                </span>
            ) : visibleActions.length > 0 ? (
                <div className="absolute right-1.5 bottom-2.5 flex flex-col gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                    {visibleActions.map((action) => {
                        const Icon = action.icon
                        return (
                            <Button
                                key={action.key}
                                variant={action.variant ?? 'secondary'}
                                size="icon-xs"
                                aria-label={action.label}
                                tooltip={action.label}
                                disabled={isDisabled}
                                className="bg-background/80"
                                onClick={(event) => {
                                    event.stopPropagation()
                                    action.onTrigger(item)
                                }}
                            >
                                <Icon className="size-3.5" />
                            </Button>
                        )
                    })}
                </div>
            ) : null}
        </Item>
    )
}
