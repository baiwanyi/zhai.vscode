/**
 * 图片卡片叠层：角标、在途遮罩、失败提示与底部说明，媒体、图库与上传三类卡片共用。
 * 复用约定：角标取 @components/ui/badge，转圈取 @components/ui/spinner，定位类只在此处声明；
 * 说明文案允许为空，超长用 truncate 收口，署名缺失由适配器折算成兜底文案。
 * 关键约束：在途遮罩必须铺满卡片并盖住图片，因此排在左上角标之后渲染；
 * 多选模式下由调用方关闭右上级角标，避免与勾选圈重叠。
 */
import { Badge } from '@components/ui/badge'
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

export function ImageCardOverlay({
    badges = [],
    title,
    isBusy = false,
    isFailed = false,
    showRightBadge = true,
}: ImageCardOverlayProps): JSX.Element {
    const visibleBadges = showRightBadge ? badges : badges.filter((badge) => badge.position !== 'top-right')

    return (
        <>
            {visibleBadges.map((badge) => (
                <Badge
                    key={`${badge.position}-${badge.text}`}
                    className={badge.position === 'top-left' ? 'absolute top-2 left-2' : 'absolute top-2 right-2'}
                    variant={badge.variant ?? 'outline'}
                >
                    {badge.text}
                </Badge>
            ))}
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
            {title === undefined ? null : (
                <span className="absolute bottom-1.5 left-1.5 max-w-[80%] truncate rounded-md bg-background/80 px-1.5 py-0.5 text-xs">
                    {title}
                </span>
            )}
        </>
    )
}
