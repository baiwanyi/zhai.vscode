/**
 * 封面图库宫格：角色设定图与作品封面共用同一套卡片、悬停操作与生成中占位。
 * 复用约定：宫格、空态与占位取 @components/ui 的 empty / skeleton / spinner / badge / button；
 * 卡片宽高比由 variant 决定（角色卡 3:4、书籍封面 2:3），不再各页面各写一套 CSS Grid。
 * 关键约束：设封面按钮只在非封面卡片上出现，随悬停或键盘聚焦显现；删除按钮必须拦截双击冒泡，
 * 否则会连带打开大图预览；生成中在首格插入同比例占位，出图后新图正好落回这一格；
 * 图库只做展示与回调，删除后的目录回读、封面顺延由调用方 hook 负责，本组件不碰磁盘。
 */
import { cn } from 'cn'
import { Image as ImageIcon, ImagePlus, Trash2 } from 'lucide-react'
import { Badge } from '@components/ui/badge'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@components/ui/empty'
import { Skeleton } from '@components/ui/skeleton'
import { Spinner } from '@components/ui/spinner'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'

/** 图库条目的最小契约：调用方的领域对象多出的字段不影响使用 */
export interface CoverGalleryItem {
    id: string
    url: string
    path: string
}

/** portrait 为角色设定图（3:4），book 为书籍封面（2:3） */
export type CoverGalleryVariant = 'portrait' | 'book'

export interface CoverGalleryProps {
    items: readonly CoverGalleryItem[]
    /** 当前封面 / 选中项的 id，null 表示未指定 */
    coverId: string | null
    variant?: CoverGalleryVariant
    /** 图库尚未回读完成：只渲染骨架，避免先闪一次「还没有」 */
    isLoading?: boolean
    /** 正在出图：首格插入同比例占位 */
    isGenerating?: boolean
    /** 有请求在飞（设封面、删除、合成）：禁用卡片上的操作按钮 */
    isBusy?: boolean
    /** 正在删除的图片路径：只禁用该张的删除按钮 */
    busyPath?: string | null
    emptyTitle: string
    emptyDescription: string
    /** 图片 alt 前缀，如「张三 的角色卡」或「《书名》的封面」 */
    altPrefix: string
    /** 删除按钮的无障碍文案，如「删除角色卡」 */
    deleteLabel: string
    /** 已生成张数的说明文案，如 (n) => `已生成 ${n} 张` */
    countLabel: (count: number) => string
    onSetCover: (item: CoverGalleryItem) => void
    onDelete: (item: CoverGalleryItem) => void
    /** 双击预览：不传时不绑定双击（书籍封面不需要大图预览） */
    onPreview?: (item: CoverGalleryItem) => void
}

const ASPECT_CLASS: Record<CoverGalleryVariant, string> = {
    portrait: 'aspect-3/4',
    book: 'aspect-2/3',
}

export function CoverGallery({
    items,
    coverId,
    variant = 'portrait',
    isLoading = false,
    isGenerating = false,
    isBusy = false,
    busyPath = null,
    emptyTitle,
    emptyDescription,
    altPrefix,
    deleteLabel,
    countLabel,
    onSetCover,
    onDelete,
    onPreview,
}: CoverGalleryProps): JSX.Element {
    const aspectClass = ASPECT_CLASS[variant]

    if (isLoading) {
        return (
            <div className="grid grid-cols-3 gap-2 p-0.5">
                <Skeleton className={cn(aspectClass, 'w-full rounded-lg')} />
            </div>
        )
    }

    if (items.length === 0 && !isGenerating) {
        return (
            <Empty className="border py-4">
                <EmptyHeader>
                    <EmptyMedia variant="icon">
                        <ImagePlus />
                    </EmptyMedia>
                    <EmptyTitle>{emptyTitle}</EmptyTitle>
                    <EmptyDescription>{emptyDescription}</EmptyDescription>
                </EmptyHeader>
            </Empty>
        )
    }

    return (
        <div className="flex flex-col gap-1.5">
            {items.length > 0 ? <p className="text-muted-foreground">{countLabel(items.length)}</p> : null}
            {/* 外留 2px：封面用外描边包住整张卡片，靠 padding 避免被滚动容器横向裁掉 */}
            <div className="grid grid-cols-3 gap-2 p-0.5">
                {/* 占位插在首位：与真实卡片同比例，出图后就落在这一格 */}
                {isGenerating ? (
                    <div className="relative overflow-hidden rounded-lg border border-border">
                        <Skeleton className={cn(aspectClass, 'w-full rounded-none')} />
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-muted-foreground">
                            <Spinner />
                            <span>生成中</span>
                        </div>
                    </div>
                ) : null}
                {items.map((item) => {
                    const isCover = item.id === coverId
                    return (
                        <div
                            key={item.id}
                            className={cn(
                                'group relative overflow-hidden rounded-lg border border-border',
                                onPreview !== undefined && 'cursor-zoom-in',
                                isCover && 'ring-2 ring-ring',
                            )}
                            onDoubleClick={
                                onPreview === undefined
                                    ? undefined
                                    : (): void => {
                                          onPreview(item)
                                      }
                            }
                        >
                            <img
                                src={item.url}
                                alt={`${altPrefix} ${item.id}`}
                                className={cn(aspectClass, 'w-full object-cover')}
                            />
                            {/* 悬停压暗 5%：只做视觉提示，不拦截点击；键盘聚焦时同样显现操作 */}
                            <div
                                className="pointer-events-none absolute inset-0 bg-black/5 opacity-0 transition-opacity group-hover:opacity-100"
                                aria-hidden="true"
                            />
                            {isCover ? (
                                <Badge variant="secondary" className="absolute top-1 left-1">
                                    封面
                                </Badge>
                            ) : (
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="absolute top-1 left-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                                    aria-label="设为封面"
                                    disabled={isBusy}
                                    onClick={() => onSetCover(item)}
                                    onDoubleClick={(event) => event.stopPropagation()}
                                >
                                    <ImageIcon />
                                </Button>
                            )}
                            <Button
                                variant="destructive"
                                size="icon"
                                className="absolute top-1 right-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                                aria-label={deleteLabel}
                                disabled={busyPath === item.path}
                                onClick={() => onDelete(item)}
                                onDoubleClick={(event) => event.stopPropagation()}
                            >
                                <Trash2 />
                            </Button>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
