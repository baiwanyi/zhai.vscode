/**
 * 生图页网格：以等宽卡片展示图片缩略图、封面徽标与删除入口。
 * 复用约定：卡片与徽标一律取 @components/ui，不手写容器；图片统一按 3:4 裁切，
 * 混合比例不会撑乱栅格，原始比例留待详情抽屉展示。
 * 关键约束：删除按钮只在悬停或聚焦时出现，避免网格噪点；封面徽标由调用方传入的
 * selectedId 比较得出，本组件不判断业务语义。
 */
import { Trash2 } from 'lucide-react'
import { Badge } from '@components/ui/badge'
import { Button } from '@components/ui/button'
import { Card } from '@components/ui/card'
import type { PressImageItem } from '@shared/types/imagegen'
import type { JSX } from 'react'

interface ImageGenGridProps {
    images: PressImageItem[]
    /** 作品封面当前指向的图片 id */
    coverSelectedId: string | null
    /** 角色 id → 名称：用于卡片角标，缺失时不显示 */
    characterNames: ReadonlyMap<string, string>
    onDelete: (image: PressImageItem) => void
    /** 点击卡片查看详情：由页面决定详情的呈现形式 */
    onSelect: (image: PressImageItem) => void
}

export function ImageGenGrid({
    images,
    coverSelectedId,
    characterNames,
    onDelete,
    onSelect,
}: ImageGenGridProps): JSX.Element {
    return (
        <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-3 xl:grid-cols-4">
            {images.map((image) => {
                const characterName = image.characterId === null ? null : characterNames.get(image.characterId)
                return (
                    <Card
                        key={image.path}
                        className="group relative cursor-pointer overflow-hidden p-0"
                        onClick={() => onSelect(image)}
                    >
                        <img
                            src={image.url}
                            alt={characterName ?? image.id}
                            className="aspect-3/4 w-full object-cover"
                            loading="lazy"
                        />
                        {image.id === coverSelectedId ? (
                            <Badge className="absolute top-2 left-2" variant="secondary">
                                封面
                            </Badge>
                        ) : null}
                        {characterName !== null ? (
                            <span className="absolute bottom-2 left-2 max-w-[70%] truncate rounded-md bg-background/80 px-1.5 py-0.5 text-xs">
                                {characterName}
                            </span>
                        ) : null}
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label="删除图片"
                            className="absolute top-1 right-1 bg-background/80 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
                            onClick={(event) => {
                                event.stopPropagation()
                                onDelete(image)
                            }}
                        >
                            <Trash2 className="size-4" />
                        </Button>
                    </Card>
                )
            })}
        </div>
    )
}
