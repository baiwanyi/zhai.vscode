/**
 * 图片列表占位：首屏骨架网格与单张在途占位卡共用一套比例与列宽口径。
 * 复用约定：骨架取 @components/ui/skeleton，转圈取 @components/ui/spinner，卡片外壳取 ui/item；
 * 宽高比与栅格类名取 imageListModel 的字面量映射，避免 Tailwind 漏扫动态拼接。
 * 关键约束：在途占位卡与真实卡片同宽同高、且只渲染在 ItemGroup 之内，出图回包后只替换一次，
 * 网格列宽不跳动；骨架仅在首屏且列表为空时出现，追加加载不整页打回骨架。
 */
import { cn } from 'cn'
import { Item } from '@components/ui/item'
import { Skeleton } from '@components/ui/skeleton'
import { Spinner } from '@components/ui/spinner'
import { IMAGE_LIST_ASPECT_CLASS, IMAGE_LIST_GRID_CLASS } from './imageListModel'
import type { ImageListAspect, ImageListColumns } from './imageListModel'
import type { JSX } from 'react'

interface ImageListSkeletonProps {
    count?: number
    columns?: ImageListColumns
    aspect?: ImageListAspect
    /** grid 为首屏整片骨架，card 为排在真实卡片之前的单张在途占位 */
    variant?: 'grid' | 'card'
}

export function ImageListSkeleton({
    count = 6,
    columns = 'compact',
    aspect = '4/3',
    variant = 'grid',
}: ImageListSkeletonProps): JSX.Element {
    const aspectClass = IMAGE_LIST_ASPECT_CLASS[aspect]

    if (variant === 'card') {
        return (
            <Item variant="outline" size="xs" aria-hidden className="relative overflow-hidden p-0">
                <Skeleton className={cn(aspectClass, 'w-full rounded-none')} />
                <Spinner aria-hidden className="absolute inset-0 m-auto size-6 text-muted-foreground" />
            </Item>
        )
    }

    return (
        <div className={IMAGE_LIST_GRID_CLASS[columns]}>
            {Array.from({ length: count }, (_, index) => (
                <Skeleton
                    key={`image-list-skeleton-${String(index)}`}
                    className={cn(aspectClass, 'w-full rounded-lg')}
                />
            ))}
        </div>
    )
}
