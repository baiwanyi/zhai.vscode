/**
 * 在线图库卡片叠层：左上角标、插入遮罩、失败重试角标与左下署名，搜索与已下载两个网格共用。
 * 复用约定：角标取 @components/ui/badge，转圈取 @components/ui/spinner；定位类收在此处，
 * 调用方只要把卡片容器设为 relative + overflow-hidden，再把本组件放在容器内即可。
 * 关键约束：遮罩必须铺满卡片并盖住图片，因此排在左上角标之后渲染；
 * 署名允许空值（手工放入 unsplash/ 的文件没有摄影师），超长用 truncate 收口。
 */
import { Badge } from '@components/ui/badge'
import { Spinner } from '@components/ui/spinner'
import type { JSX } from 'react'

interface StockPhotoOverlayProps {
    /** 左下署名：null 表示本地手工放入的图，走兜底文案 */
    photographer: string | null
    /** 左上角标文案：省略则不渲染该角标 */
    cornerLabel?: string
    /** 左上角标配色：已下载用 secondary，已丢失用 outline（默认） */
    cornerVariant?: 'outline' | 'secondary'
    /** 正在插入：铺满卡片的半透明遮罩 + 转圈 */
    isInserting: boolean
    /** 上次插入失败：右上角给「重试」提示 */
    isFailed: boolean
}

export function StockPhotoOverlay({
    photographer,
    cornerLabel,
    cornerVariant = 'outline',
    isInserting,
    isFailed,
}: StockPhotoOverlayProps): JSX.Element {
    return (
        <>
            {cornerLabel === undefined ? null : (
                <Badge className="absolute top-2 left-2" variant={cornerVariant}>
                    {cornerLabel}
                </Badge>
            )}
            {isInserting ? (
                <span className="absolute inset-0 flex items-center justify-center bg-background/60">
                    <Spinner className="size-5" />
                </span>
            ) : null}
            {isFailed ? (
                <Badge className="absolute top-2 right-2" variant="destructive">
                    重试
                </Badge>
            ) : null}
            <span className="absolute bottom-1.5 left-1.5 max-w-[80%] truncate rounded-md bg-background/80 px-1.5 py-0.5 text-xs">
                {photographer ?? '本地图片'}
            </span>
        </>
    )
}
