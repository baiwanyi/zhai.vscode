/**
 * 通用图片选择面板：Popover 内以标签页切换生图、已下载在线图库与上传图片三个来源。
 * 复用约定：数据源与上传动作由外部经 props 注入（控制器来自 useImagePickerSources），
 * 本组件只负责面板骨架、标签切换、Attachment 缩略图列表与选中态，命中条目统一以 ImagePickerItem 回传；
 * 上传按钮位于标题右侧，上传完成由调用方把新增图片写入外部列表并按需切到上传标签。
 * 关键约束：已选路径条目置灰并标记，避免重复加入；每栏按固定步长增量渲染，图库上千张也不一次挂满 DOM；
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
    AttachmentContent,
    AttachmentGroup,
    AttachmentMedia,
    AttachmentTitle,
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
import { Button } from '@webview/components/Button'
import { Image } from '@webview/components/Image'
import type { ImagePickerItem, ImagePickerSourceState, ImageSourceKind } from '@webview/hooks/useImagePickerSources'
import { useRenderLimit } from '@webview/hooks/useRenderLimit'
import type { JSX, ReactNode } from 'react'

/** 标签页每批展示的张数：图库可能有上千张，按需增量渲染避免一次挂满 DOM */
const PAGE_SIZE = 60

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
    /** 上传图片：调用方处理落盘并把新增条目写入外部列表，返回本次新增供面板切到上传标签 */
    onUpload: () => Promise<readonly ImagePickerItem[]>
    /** 选中一张图片：kind 标明来自哪个标签页 */
    onSelect: (item: ImagePickerItem, kind: ImageSourceKind) => void
    onCloseAutoFocus?: (event: Event) => void
}

/** 单栏缩略图附件列表：加载 / 空态 / Attachment 网格与选中态 + 加载更多 */
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
        return <Empty isLoading title="正在读取图片..." icon={Images} className="py-8" />
    }
    if (items.length === 0) {
        return <Empty title={emptyTitle} icon={Images} className="py-8" />
    }

    return (
        <div className="flex flex-col gap-2">
            <AttachmentGroup className="max-h-64 flex-wrap overflow-y-auto">
                {visibleItems.map((item) => {
                    const isSelected = selected.has(item.path)
                    return (
                        <Attachment
                            key={item.id}
                            title={item.alt}
                            orientation="vertical"
                            size="sm"
                            state={isSelected ? 'done' : 'idle'}
                            className={cn(isSelected && 'ring-2 ring-primary')}
                        >
                            <AttachmentMedia variant="image">
                                <Image src={item.url} alt={item.alt} />
                            </AttachmentMedia>
                            <AttachmentContent className="w-full">
                                <AttachmentTitle>{item.alt}</AttachmentTitle>
                            </AttachmentContent>
                            {isSelected ? (
                                <AttachmentActions>
                                    <AttachmentAction variant="secondary" aria-label="已选择" disabled>
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

export interface ImageUploadButtonProps {
    /** 读取原图等处理中：禁用上传按钮，避免连点 */
    disabled: boolean
    isUploading: boolean
    /** 上传图片：调用方处理落盘并把新增条目写入外部列表 */
    onUpload: () => Promise<readonly ImagePickerItem[]>
    /** 本次上传有新增图片：通知调用方切到上传标签 */
    onUploaded: () => void
}

/** 标题右侧的上传按钮：上传完成且有新增时通知调用方切标签，便于脱离面板独立复用 */
export function ImageUploadButton({
    disabled,
    isUploading,
    onUpload,
    onUploaded,
}: ImageUploadButtonProps): JSX.Element {
    const handleUpload = (): void => {
        void onUpload().then((uploaded) => {
            if (uploaded.length > 0) {
                onUploaded()
            }
        })
    }

    return (
        <Button
            variant="secondary"
            size="icon-sm"
            tooltip="上传图片"
            disabled={disabled}
            isLoading={isUploading}
            onClick={handleUpload}
        >
            <Upload className="size-3.5" aria-hidden="true" />
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
                    <div className="flex items-center gap-2">
                        <PopoverTitle>{title}</PopoverTitle>
                        <Badge variant="outline" tooltip={`共 ${String(totalCount)} 张图片`}>
                            {totalCount}
                        </Badge>
                    </div>
                    <ImageUploadButton
                        disabled={disabled}
                        isUploading={isUploading}
                        onUpload={onUpload}
                        onUploaded={(): void => setTab('upload')}
                    />
                </PopoverHeader>
                {description === undefined ? null : <PopoverDescription>{description}</PopoverDescription>}
                <ImagePickerTabs
                    value={tab}
                    onValueChange={(next): void => setTab(next)}
                    sources={sources}
                    selectedPaths={selectedPaths}
                    disabled={disabled}
                    onSelect={onSelect}
                />
            </PopoverContent>
        </Popover>
    )
}
