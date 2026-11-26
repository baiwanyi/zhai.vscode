/**
 * 通用图片选择面板：Popover 内以标签页切换生图、已下载在线图库与上传图片三个来源。
 * 复用约定：数据源与上传动作由外部经 props 注入（控制器来自 useImagePickerSources），
 * 本组件只负责面板骨架、标签切换、缩略图网格与选中态，命中条目统一以 ImagePickerItem 回传；
 * 上传按钮位于标题右侧，上传完成由调用方把新增图片写入外部列表并按需切到上传标签。
 * 关键约束：已选路径条目置灰并标记，避免重复加入；每栏按固定步长增量渲染，图库上千张也不一次挂满 DOM；
 * 面板 open 完全受控，选中后是否关闭由调用方决定；关闭时不抢焦点，方便继续编辑正文。
 */
'use client'

import { cn } from 'cn'
import { Check, Upload } from 'lucide-react'
import { useState } from 'react'
import {
    Popover,
    PopoverContent,
    PopoverDescription,
    PopoverHeader,
    PopoverTitle,
    PopoverTrigger,
} from '@components/ui/popover'
import { Spinner } from '@components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@components/ui/tabs'
import { Button } from '@webview/components/Button'
import { Image } from '@webview/components/Image'
import type { ImagePickerItem, ImagePickerSourceState, ImageSourceKind } from '@webview/hooks/useImagePickerSources'
import { useRenderLimit } from '@webview/hooks/useRenderLimit'
import type { JSX, ReactNode } from 'react'

/** 标签页每批展示的张数：图库可能有上千张，按需增量渲染避免一次挂满 DOM */
const PAGE_SIZE = 60

/** 三个标签页的固定顺序与文案 */
const SOURCE_TABS: readonly { kind: ImageSourceKind; label: string; emptyTitle: string }[] = [
    { kind: 'generate', label: '生图', emptyTitle: '还没有生图结果' },
    { kind: 'stock', label: '在线图库', emptyTitle: '还没有已下载的在线图片' },
    { kind: 'upload', label: '上传图片', emptyTitle: '还没有上传过图片' },
]

/** Tabs 回传的是字符串，收窄回来源联合类型而不是直接断言 */
function isSourceKind(value: string): value is ImageSourceKind {
    return value === 'generate' || value === 'stock' || value === 'upload'
}

export interface ImagePickerProps {
    /** 面板开合完全受控：调用方决定选中后是否关闭 */
    open: boolean
    onOpenChange: (open: boolean) => void
    /** Popover 触发器，如工具栏图标按钮 */
    trigger: ReactNode
    title?: string
    description?: string
    /** 三个来源的清单与读取状态，来自 useImagePickerSources */
    sources: Record<ImageSourceKind, ImagePickerSourceState>
    /** 已选路径：对应条目置灰并标记，避免重复添加 */
    selectedPaths: readonly string[]
    isUploading: boolean
    /** 读取原图等处理中：禁用网格与上传，避免连点 */
    disabled?: boolean
    align?: 'start' | 'center' | 'end'
    className?: string
    /** 上传图片：调用方处理落盘并把新增条目写入外部列表，返回本次新增供面板切到上传标签 */
    onUpload: () => Promise<readonly ImagePickerItem[]>
    /** 选中一张图片：kind 标明来自哪个标签页 */
    onSelect: (item: ImagePickerItem, kind: ImageSourceKind) => void
    onCloseAutoFocus?: (event: Event) => void
}

/** 单栏网格：加载态 / 空态 / 缩略图 + 加载更多 */
function ImageGrid({
    items,
    isLoading,
    emptyTitle,
    selectedPaths,
    disabled,
    onSelect,
}: {
    items: readonly ImagePickerItem[]
    isLoading: boolean
    emptyTitle: string
    selectedPaths: readonly string[]
    disabled: boolean
    onSelect: (item: ImagePickerItem) => void
}): JSX.Element {
    const { limit, hasMore, remaining, loadMore } = useRenderLimit(items.length, PAGE_SIZE)
    const visibleItems = items.slice(0, limit)
    const selected = new Set(selectedPaths)

    if (isLoading && items.length === 0) {
        return (
            <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground text-xs">
                <Spinner className="size-3.5" aria-hidden="true" />
                正在读取图片...
            </div>
        )
    }
    if (items.length === 0) {
        return <div className="py-8 text-center text-muted-foreground text-xs">{emptyTitle}</div>
    }

    return (
        <div className="flex flex-col gap-2">
            <div className="grid max-h-64 grid-cols-3 gap-1.5 overflow-y-auto">
                {visibleItems.map((item) => {
                    const isSelected = selected.has(item.path)
                    return (
                        <button
                            key={item.id}
                            type="button"
                            title={item.alt}
                            aria-label={`选择图片：${item.alt}`}
                            aria-pressed={isSelected}
                            disabled={disabled || isSelected}
                            className={cn(
                                'group relative aspect-square overflow-hidden rounded-md border border-border bg-muted',
                                isSelected ? 'cursor-default' : 'hover:ring-2 hover:ring-ring',
                            )}
                            onClick={() => onSelect(item)}
                        >
                            <Image src={item.url} alt={item.alt} className="w-full object-cover" loading="lazy" />
                            {/* 悬停与键盘聚焦压一层 20% 黑遮罩并亮出选择图标，已选项常亮显示对勾 */}
                            <span
                                aria-hidden
                                className={cn(
                                    'pointer-events-none absolute inset-0 flex items-center justify-center rounded-sm bg-black/20 opacity-0 transition-opacity group-focus-visible:opacity-100 group-hover:opacity-100',
                                    isSelected && 'bg-background/60 opacity-100',
                                )}
                            >
                                <span className="flex size-7 items-center justify-center rounded-full bg-primary/70 text-primary-foreground">
                                    <Check className="size-3.5" />
                                </span>
                            </span>
                        </button>
                    )
                })}
            </div>
            <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground text-xs">{`共 ${String(items.length)} 张`}</span>
                {hasMore ? (
                    <Button variant="outline" size="sm" disabled={disabled} onClick={loadMore}>
                        {`加载更多（还有 ${String(remaining)} 张）`}
                    </Button>
                ) : null}
            </div>
        </div>
    )
}

export function ImagePicker({
    open,
    onOpenChange,
    trigger,
    title = '选择图片',
    description,
    sources,
    selectedPaths,
    isUploading,
    disabled = false,
    align = 'start',
    className,
    onUpload,
    onSelect,
    onCloseAutoFocus,
}: ImagePickerProps): JSX.Element {
    const [tab, setTab] = useState<ImageSourceKind>('upload')

    const handleUpload = (): void => {
        void onUpload().then((uploaded) => {
            if (uploaded.length > 0) {
                setTab('upload')
            }
        })
    }

    return (
        <Popover open={open} onOpenChange={onOpenChange}>
            <PopoverTrigger asChild>{trigger}</PopoverTrigger>
            <PopoverContent
                align={align}
                className={cn('w-auto max-w-96', className)}
                onCloseAutoFocus={
                    onCloseAutoFocus ??
                    ((event): void => {
                        event.preventDefault()
                    })
                }
            >
                <PopoverHeader className="flex-row items-center justify-between gap-2">
                    <PopoverTitle>{title}</PopoverTitle>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={disabled}
                        isLoading={isUploading}
                        onClick={handleUpload}
                    >
                        <Upload className="size-3.5" aria-hidden="true" />
                        上传图片
                    </Button>
                </PopoverHeader>
                {description === undefined ? null : <PopoverDescription>{description}</PopoverDescription>}
                <Tabs
                    value={tab}
                    onValueChange={(value): void => {
                        if (isSourceKind(value)) {
                            setTab(value)
                        }
                    }}
                >
                    <TabsList className="grid w-full grid-cols-3">
                        {SOURCE_TABS.map((source) => (
                            <TabsTrigger key={source.kind} value={source.kind}>
                                {source.label}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                    {SOURCE_TABS.map((source) => (
                        <TabsContent key={source.kind} value={source.kind} className=" p-1">
                            <ImageGrid
                                items={sources[source.kind].items}
                                isLoading={sources[source.kind].isLoading}
                                emptyTitle={source.emptyTitle}
                                selectedPaths={selectedPaths}
                                disabled={disabled}
                                onSelect={(item): void => onSelect(item, source.kind)}
                            />
                        </TabsContent>
                    ))}
                </Tabs>
            </PopoverContent>
        </Popover>
    )
}
