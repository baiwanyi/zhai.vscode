/**
 * 通用图片选择面板：Popover 内以标签页切换生图、已下载在线图库与上传图片三个来源。
 * 复用约定：数据源与上传动作由外部经 props 注入（控制器来自 useImagePickerSources），
 * 本组件只负责面板骨架、标签切换、Attachment 缩略图列表与选中态，命中条目统一以 ImagePickerItem 回传；
 * 上传按钮位于标签区下方并满宽，上传完成由调用方把新增图片写入外部列表并按需切到上传标签。
 * 关键约束：已选路径条目置灰并标记，避免重复加入；每栏只渲染首批固定张数，图库上千张也不一次挂满 DOM；
 * 面板 open 完全受控，选中后是否关闭由调用方决定；关闭时不抢焦点，方便继续编辑正文；
 * 上传按钮与来源标签区分别抽为可独立导出的组件，脱离面板时由调用方自行持有 tab 状态与上传落盘逻辑。
 */
'use client'

import { cn } from 'cn'
import { Check, Images, Upload } from 'lucide-react'
import { useState } from 'react'
import {
    Attachment,
    AttachmentAction,
    AttachmentActions,
    AttachmentGroup,
    AttachmentMedia,
    AttachmentTrigger,
} from '@components/ui/attachment'
import {
    Popover,
    PopoverContent,
    PopoverDescription,
    PopoverHeader,
    PopoverTitle,
    PopoverTrigger,
} from '@components/ui/popover'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@components/ui/tabs'
import { Badge } from '@webview/blocks/Badge'
import { Empty } from '@webview/blocks/Empty'
import { Button, type ButtonProps } from '@webview/components/Button'
import { Image } from '@webview/components/Image'
import type { ImagePickerItem, ImagePickerSourceState, ImageSourceKind } from '@webview/hooks/useImagePickerSources'
import { useRenderLimit } from '@webview/hooks/useRenderLimit'
import type { JSX, ReactNode } from 'react'

/** 标签页每批展示的张数：配合首批批次数限制渲染总量，避免图库一次挂满 DOM */
const PAGE_SIZE = 30

/** 只渲染前 10 批：开局展开固定张数后不再加载超出部分，避免图库一次挂满 DOM */
const AUTO_LOAD_BATCHES = 10

/** 三个标签页的固定顺序与文案 */
const SOURCE_TABS: readonly { kind: ImageSourceKind; label: string; emptyTitle: string }[] = [
    { kind: 'generate', label: 'AI 生图', emptyTitle: '还没有 AI 生图结果' },
    { kind: 'stock', label: '在线图库', emptyTitle: '还没有已下载的在线图片' },
    { kind: 'upload', label: '上传图片', emptyTitle: '还没有上传过图片' },
]

/** Tabs 回传的是字符串，收窄回来源联合类型而不是直接断言 */
function isSourceKind(value: string): value is ImageSourceKind {
    return value === 'generate' || value === 'stock' || value === 'upload'
}

export interface ImagePickerPopoverProps {
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
    /** 面板附加内容：渲染在说明与标签栏之间，供调用方插入自定义区块 */
    children?: ReactNode
    /** 上传图片：调用方处理落盘并把新增条目写入外部列表，返回本次新增供面板切到上传标签 */
    onUpload: () => Promise<readonly ImagePickerItem[]>
    /** 选中一张图片：kind 标明来自哪个标签页 */
    onSelect: (item: ImagePickerItem, kind: ImageSourceKind) => void
    onCloseAutoFocus?: (event: Event) => void
}

/** 单栏缩略图附件列表：加载 / 空态 / Attachment 网格与选中态 */
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
    const { limit } = useRenderLimit(items.length, PAGE_SIZE, '', AUTO_LOAD_BATCHES)
    const visibleItems = items.slice(0, limit)
    const selected = new Set(selectedPaths)

    if (isLoading && items.length === 0) {
        return <Empty isLoading title="正在读取图片..." icon={Images} className="py-8" />
    }
    if (items.length === 0) {
        return <Empty title={emptyTitle} icon={Images} className="py-8" />
    }

    return (
        <AttachmentGroup className="grid grid-cols-3 gap-2 max-h-64 overflow-y-auto px-0.5">
            {visibleItems.map((item) => {
                const isSelected = selected.has(item.path)
                return (
                    <Attachment
                        key={item.id}
                        orientation="vertical"
                        state={isSelected ? 'done' : 'idle'}
                        className={cn(
                            'w-full has-data-[slot=attachment-media]:p-1',
                            isSelected && 'ring-1 ring-primary',
                        )}
                    >
                        <AttachmentMedia variant="image">
                            <Image src={item.url} alt={item.alt} />
                        </AttachmentMedia>
                        {isSelected ? (
                            <AttachmentActions className="group-data-[orientation=vertical]/attachment:top-1 group-data-[orientation=vertical]/attachment:right-1">
                                <AttachmentAction variant="default" className="rounded-full" disabled>
                                    <Check data-icon />
                                </AttachmentAction>
                            </AttachmentActions>
                        ) : null}
                        <AttachmentTrigger
                            disabled={disabled || isSelected}
                            aria-label={`选择图片：${item.alt}`}
                            aria-pressed={isSelected}
                            onClick={() => onSelect(item)}
                        />
                    </Attachment>
                )
            })}
        </AttachmentGroup>
    )
}

export interface ImageUploadButtonProps {
    /** 读取原图等处理中：禁用上传按钮，避免连点 */
    disabled: boolean
    isUploading: boolean
    /** 上传图片：调用方处理落盘并把新增条目写入外部列表 */
    onUpload: () => Promise<readonly ImagePickerItem[]>
    /** 本次上传有新增图片：通知调用方切到上传标签 */
    onUploaded: () => void
    /** 变体：默认 secondary，铺满一行时可按面板层级换成 outline 等 */
    variant?: ButtonProps['variant']
    /**
     * 尺寸档位：默认 icon 只放图标，供标题行这类紧凑位置使用；
     * 文字档（如 default）会补出「上传图片」文案，配 className="w-full" 铺满一行。
     */
    size?: ButtonProps['size']
    className?: string
}

/** 上传按钮：上传完成且有新增时通知调用方切标签，便于脱离面板独立复用 */
export function ImageUploadButton({
    disabled,
    isUploading,
    onUpload,
    onUploaded,
    variant = 'secondary',
    size = 'icon',
    className,
}: ImageUploadButtonProps): JSX.Element {
    const handleUpload = (): void => {
        void onUpload().then((uploaded) => {
            if (uploaded.length > 0) {
                onUploaded()
            }
        })
    }

    // 图标档位塞文字会把方形按钮撑变形，只有文字档位（含 null 落回默认尺寸）才补文案
    const isIconOnly = size !== null && size.startsWith('icon')

    return (
        <Button
            variant={variant}
            size={size}
            tooltip="上传图片"
            disabled={disabled}
            isLoading={isUploading}
            onClick={handleUpload}
            className={className}
        >
            <Upload className="size-3.5" aria-hidden="true" />
            {isIconOnly ? null : '上传图片'}
        </Button>
    )
}

export interface ImagePickerTabsProps {
    /** 当前来源标签，受控 */
    value: ImageSourceKind
    onValueChange: (kind: ImageSourceKind) => void
    /** 三个来源的清单与读取状态，来自 useImagePickerSources */
    sources: Record<ImageSourceKind, ImagePickerSourceState>
    selectedPaths: readonly string[]
    disabled: boolean
    onSelect: (item: ImagePickerItem, kind: ImageSourceKind) => void
}

/** 来源标签区：受控标签切换与三栏网格渲染，收窄字符串标签避免非法来源值 */
export function ImagePickerTabs({
    value,
    onValueChange,
    sources,
    selectedPaths,
    disabled,
    onSelect,
}: ImagePickerTabsProps): JSX.Element {
    return (
        <Tabs
            value={value}
            onValueChange={(next): void => {
                if (isSourceKind(next)) {
                    onValueChange(next)
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
    )
}

export function ImagePickerPopover({
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
    children,
    onUpload,
    onSelect,
    onCloseAutoFocus,
}: ImagePickerPopoverProps): JSX.Element {
    const [tab, setTab] = useState<ImageSourceKind>('upload')
    const totalCount = SOURCE_TABS.reduce((sum, source) => sum + sources[source.kind].items.length, 0)

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
                <PopoverHeader className="flex-row items-center justify-between">
                    <PopoverTitle>{title}</PopoverTitle>
                    <Badge variant="outline" tooltip={`共 ${String(totalCount)} 张图片`}>
                        {totalCount}
                    </Badge>
                </PopoverHeader>
                {description === undefined ? null : <PopoverDescription>{description}</PopoverDescription>}
                {children}
                <ImagePickerTabs
                    value={tab}
                    onValueChange={(next): void => setTab(next)}
                    sources={sources}
                    selectedPaths={selectedPaths}
                    disabled={disabled}
                    onSelect={onSelect}
                />
                <ImageUploadButton
                    disabled={disabled}
                    isUploading={isUploading}
                    onUpload={onUpload}
                    onUploaded={(): void => setTab('upload')}
                    size="default"
                    className="w-full"
                />
            </PopoverContent>
        </Popover>
    )
}
