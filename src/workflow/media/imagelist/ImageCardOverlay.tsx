/**
 * 图片卡片叠层：三处角标、在途遮罩、失败提示与底部说明，媒体、图库与上传三类卡片共用。
 * 复用约定：角标取 @components/ui/badge，转圈取 @components/ui/spinner，关联标题取 @components/ui/hover-card 与 skeleton；
 * 定位类只在此处声明；说明文案允许为空，超长用 truncate 收口。
 * 关键约束：带 hoverTitles 的角标在首次悬停时才按需拉取标题，列表阶段不为每张图各发一次请求；
 * 左下角只放信息角标（关联计数、上传尺寸），悬停操作条由卡片排在右下角，两者不占用同一区域；
 * 在途遮罩必须铺满卡片并盖住图片，因此排在角标之后渲染；
 * 多选模式下由调用方关闭右上级角标，避免与勾选圈重叠。
 */
import { useState } from 'react'
import { Badge } from '@components/ui/badge'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@components/ui/hover-card'
import { Skeleton } from '@components/ui/skeleton'
import { Spinner } from '@components/ui/spinner'
import type { ImageListBadge } from './imageListModel'
import type { JSX } from 'react'

interface ImageCardOverlayProps {
    badges?: readonly ImageListBadge[]
    title?: string
    isBusy?: boolean
    isFailed?: boolean
    showRightBadge?: boolean
}

interface CardBadgeProps {
    badge: ImageListBadge
}

/** 单个角标：带 hoverTitles 时变成可悬停角标，内容区只在打开后挂载 */
function CardBadge({ badge }: CardBadgeProps): JSX.Element {
    const [titles, setTitles] = useState<readonly string[] | null>(null)
    const Icon = badge.icon
    const badgeNode = (
        <Badge variant={badge.variant ?? 'outline'} className="bg-background/80 gap-1 px-1.5">
            {Icon === undefined ? null : <Icon className="size-3" />}
            {badge.text === undefined ? null : <span className="tabular-nums">{badge.text}</span>}
        </Badge>
    )

    const loadTitles = badge.hoverTitles
    if (loadTitles === undefined) {
        return badgeNode
    }

    /** 首次悬停才发请求：失败按「无引用」处理，悬停态不因报错卡在骨架屏 */
    function handleOpenChange(isOpen: boolean): void {
        if (!isOpen || titles !== null || loadTitles === undefined) {
            return
        }
        void loadTitles()
            .then((value) => {
                setTitles(value)
            })
            .catch(() => {
                setTitles([])
            })
    }

    return (
        <HoverCard openDelay={150} closeDelay={80} onOpenChange={handleOpenChange}>
            <HoverCardTrigger asChild>{badgeNode}</HoverCardTrigger>
            <HoverCardContent side="top" align="start" sideOffset={6} className="w-56">
                {titles === null ? (
                    <Skeleton className="h-3.5 w-28" />
                ) : titles.length === 0 ? (
                    <p className="text-muted-foreground text-xs">暂未被引用</p>
                ) : (
                    <ul className="flex flex-col gap-1">
                        {titles.map((title) => (
                            <li key={title} className="truncate text-xs">
                                {title}
                            </li>
                        ))}
                    </ul>
                )}
            </HoverCardContent>
        </HoverCard>
    )
}

export function ImageCardOverlay({
    badges = [],
    title,
    isBusy = false,
    isFailed = false,
    showRightBadge = true,
}: ImageCardOverlayProps): JSX.Element {
    const topBadges = badges.filter((badge) => badge.position !== 'bottom-left')
    const bottomBadges = badges.filter((badge) => badge.position === 'bottom-left')
    const visibleTopBadges = showRightBadge ? topBadges : topBadges.filter((badge) => badge.position !== 'top-right')
    const hasBottomLeft = bottomBadges.length > 0

    return (
        <>
            {visibleTopBadges.map((badge) => (
                <span
                    key={`${badge.position}-${badge.text ?? ''}`}
                    className={badge.position === 'top-left' ? 'absolute top-2 left-2' : 'absolute top-2 right-2'}
                >
                    <CardBadge badge={badge} />
                </span>
            ))}
            {hasBottomLeft ? (
                <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1">
                    {bottomBadges.map((badge) => (
                        <CardBadge key={`bottom-${badge.text ?? ''}`} badge={badge} />
                    ))}
                </div>
            ) : null}
            {isBusy ? (
                <span className="absolute inset-0 flex items-center justify-center bg-background/60">
                    <Spinner className="size-5" />
                </span>
            ) : null}
            {isFailed ? (
                <Badge className="absolute top-2 right-2" variant="destructive">
                    重试
                </Badge>
            ) : null}
            {title === undefined || hasBottomLeft ? null : (
                <span className="absolute bottom-1.5 left-1.5 max-w-[80%] truncate rounded-md bg-background/80 px-1.5 py-0.5 text-xs">
                    {title}
                </span>
            )}
        </>
    )
}
