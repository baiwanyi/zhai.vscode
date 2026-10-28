/**
 * 生图页网格：以等宽卡片展示图片缩略图、封面徽标与悬停操作（复制、插入、删除）。
 * 复用约定：卡片与徽标一律取 @components/ui，不手写容器；图片统一按 3:4 裁切，
 * 混合比例不会撑乱栅格，原始比例留待详情面板展示。
 * 关键约束：在途出图时在首位渲染与卡片同比例（3:4）的骨架占位，正中压一个转圈表示还在等，
 * 出图后由真实图片顶替，列宽不跳动；
 * 操作按钮只在悬停或聚焦时出现，避免网格噪点；多选模式下点击卡片是切换选中而不是打开详情，
 * 且隐藏悬停操作，避免与勾选冲突；封面徽标由调用方传入的 selectedId 比较得出，本组件不判断业务语义；
 * 卡片可聚焦，回车/空格触发与点击相同的动作，内部操作按钮的键盘事件不被外层拦截。
 */
import { cn } from 'cn'
import { Check, Copy, TextCursorInput, Trash2 } from 'lucide-react'
import { Badge } from '@components/ui/badge'
import { Card } from '@components/ui/card'
import { Skeleton } from '@components/ui/skeleton'
import { Spinner } from '@components/ui/spinner'
import type { PressImageItem } from '@shared/types/imagegen'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'

/** 悬停操作按钮的公共样式：半透明底避免压住缩略图 */
const ACTION_CLASS = 'bg-background/80'

interface ImageGenGridProps {
    images: PressImageItem[]
    /**
     * 生成中的占位卡数量：0 表示没有在途请求。
     * 占位卡排在真实图片之前，用与卡片一致的 3:4 比例，出图后由真实图片顶替，网格列宽不跳动。
     */
    pendingCount: number
    /** 作品封面当前指向的图片 id */
    coverSelectedId: string | null
    /** 角色 id → 名称：用于卡片角标，缺失时不显示 */
    characterNames: ReadonlyMap<string, string>
    /** 条目 id → 名称：设定图用同一个角标位显示条目名 */
    loreNames: ReadonlyMap<string, string>
    /** 多选模式：点击卡片切换选中，不再打开详情 */
    isSelecting: boolean
    /** 已选中的图片路径集合 */
    selectedPaths: ReadonlySet<string>
    onToggleSelect: (image: PressImageItem) => void
    onDelete: (image: PressImageItem) => void
    onCopy: (image: PressImageItem) => void
    onInsert: (image: PressImageItem) => void
    /** 点击卡片查看详情：由页面决定详情的呈现形式 */
    onSelect: (image: PressImageItem) => void
}

export function ImageGenGrid({
    images,
    pendingCount,
    coverSelectedId,
    characterNames,
    loreNames,
    isSelecting,
    selectedPaths,
    onToggleSelect,
    onDelete,
    onCopy,
    onInsert,
    onSelect,
}: ImageGenGridProps): JSX.Element {
    return (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: pendingCount }, (_, index) => (
                <Card key={`pending-${String(index)}`} aria-hidden className="relative overflow-hidden p-0">
                    <Skeleton className="aspect-3/4 w-full rounded-none" />
                    {/* 转圈压在骨架正中心：纯视觉提示，语义已由外层占位卡承担 */}
                    <Spinner aria-hidden className="absolute inset-0 m-auto size-6 text-muted-foreground" />
                </Card>
            ))}
            {images.map((image) => {
                // 归属名：角色图取角色名，设定图取条目名，普通图没有角标
                const ownerName =
                    image.characterId !== null
                        ? (characterNames.get(image.characterId) ?? null)
                        : image.loreId === null
                          ? null
                          : (loreNames.get(image.loreId) ?? null)
                const isChecked = selectedPaths.has(image.path)
                /** 卡片主动作：多选时切换勾选，否则打开详情；点击与键盘共用同一分支 */
                const activate = (): void => {
                    if (isSelecting) {
                        onToggleSelect(image)
                        return
                    }
                    onSelect(image)
                }
                return (
                    <Card
                        key={image.path}
                        tabIndex={0}
                        aria-label={`${isSelecting ? '选择' : '查看详情'}：${ownerName ?? image.id}`}
                        className={cn(
                            'group relative cursor-pointer overflow-hidden p-0 outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            isChecked && 'ring-2 ring-primary',
                        )}
                        onClick={activate}
                        onKeyDown={(event) => {
                            // 焦点落在内部操作按钮时不拦截，避免回车既触发按钮又打开详情
                            if (event.target !== event.currentTarget) {
                                return
                            }
                            if (event.key !== 'Enter' && event.key !== ' ') {
                                return
                            }
                            event.preventDefault()
                            activate()
                        }}
                    >
                        <img
                            src={image.url}
                            alt={ownerName ?? image.id}
                            className="aspect-3/4 w-full object-cover"
                            loading="lazy"
                        />
                        {image.id === coverSelectedId ? (
                            <Badge className="absolute top-2 left-2" variant="secondary">
                                封面
                            </Badge>
                        ) : null}
                        {ownerName !== null ? (
                            <span className="absolute bottom-2 left-2 max-w-[70%] truncate rounded-md bg-background/80 px-1.5 py-0.5 text-xs">
                                {ownerName}
                            </span>
                        ) : null}
                        {isSelecting ? (
                            <span
                                aria-hidden
                                className={cn(
                                    'absolute top-2 right-2 flex size-5 items-center justify-center rounded-full border',
                                    isChecked
                                        ? 'border-primary bg-primary text-primary-foreground'
                                        : 'bg-background/80',
                                )}
                            >
                                {isChecked ? <Check className="size-3.5" /> : null}
                            </span>
                        ) : (
                            <div className="absolute top-1 right-1 flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="复制图片"
                                    className={ACTION_CLASS}
                                    onClick={(event) => {
                                        event.stopPropagation()
                                        onCopy(image)
                                    }}
                                >
                                    <Copy className="size-4" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="插入到文章"
                                    className={ACTION_CLASS}
                                    onClick={(event) => {
                                        event.stopPropagation()
                                        onInsert(image)
                                    }}
                                >
                                    <TextCursorInput className="size-4" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="删除图片"
                                    className={ACTION_CLASS}
                                    onClick={(event) => {
                                        event.stopPropagation()
                                        onDelete(image)
                                    }}
                                >
                                    <Trash2 className="size-4" />
                                </Button>
                            </div>
                        )}
                    </Card>
                )
            })}
        </div>
    )
}
