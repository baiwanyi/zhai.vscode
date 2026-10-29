/**
 * 媒体详情弹窗：按原始比例查看大图，并分区展示「出处」与「引用」，就地设为作品封面、复制、插入或删除。
 * 复用约定：弹层取 ui/dialog，图片取 components/Image，参数折叠块取 ui/collapsible，空态取 ui/empty；
 * 出处与引用由 useImageDetail 按媒体 id 一次读回，引用已由宿主按类型与时间排好序，前端只分组不重排。
 * 关键约束：image 为 null 即关闭，关闭只经 onOpenChange 上报；复制、插入、删除与设封面一律交给页面，
 * 本组件不直接调宿主协议，避免副作用散落两处；
 * 引用是「一对多」——同一张图可以同时是作品封面、多个章节插图与多篇笔记配图，必须逐条列出而不是合并成一句；
 * 弹窗高度取视口高上下各留 2rem，仅内容区滚动，图片按 contain 缩放不撑破窗口；
 * 打开时的初始焦点必须交给弹层容器，否则 Radix 聚焦首个按钮会连带弹出 tooltip。
 */
import { Copy, ExternalLink, TextCursorInput, Trash2 } from 'lucide-react'
import { useMemo, useRef } from 'react'
import { toast } from 'sonner'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@components/ui/dialog'
import { Skeleton } from '@components/ui/skeleton'
import type { MediaItem, MediaRefType, MediaUsageItem } from '@shared/types/media'
import { formatDateTime } from '@shared/utils/format'
import { Button } from '@webview/components/Button'
import { Image } from '@webview/components/Image'
import type { JSX } from 'react'
import { useImageDetail } from '../hooks/useImageDetail'

/** 引用类型文案：与宿主 ref_type 一一对应 */
const REF_LABELS: Readonly<Record<MediaRefType, string>> = {
    press_cover: '作品封面',
    character_cover: '角色封面',
    lore_cover: '条目封面',
    chapter: '章节',
    note: '笔记',
    external: '外部文档',
}

/** 引用分组的固定顺序：封面类在前、正文类在后，跨类型阅读时顺序稳定 */
const REF_ORDER: readonly MediaRefType[] = [
    'press_cover',
    'character_cover',
    'lore_cover',
    'chapter',
    'note',
    'external',
]

/** 引用分组：同一类型聚在一起，组内沿用宿主返回的时间倒序 */
interface UsageGroup {
    refType: MediaRefType
    label: string
    items: MediaUsageItem[]
}

/** 按类型分组：只保留实际存在的类型，空组不渲染 */
function groupUsages(usages: readonly MediaUsageItem[]): UsageGroup[] {
    const buckets = new Map<MediaRefType, MediaUsageItem[]>()
    for (const usage of usages) {
        const list = buckets.get(usage.refType) ?? []
        list.push(usage)
        buckets.set(usage.refType, list)
    }
    return REF_ORDER.filter((refType) => buckets.has(refType)).map((refType) => ({
        refType,
        label: REF_LABELS[refType],
        items: buckets.get(refType) ?? [],
    }))
}

/** 出处一行：角色 / 设定 / 作品三选一，全空时说明未关联 */
interface OriginLine {
    label: string
    value: string
}

/** 出处信息：全部取自媒体条目的快照字段，不再回查人物卡与条目文档 */
function toOriginLines(item: MediaItem): OriginLine[] {
    const lines: OriginLine[] = []
    if (item.pressName !== null && item.pressName.length > 0) {
        lines.push({ label: '作品', value: item.pressName })
    }
    if (item.characterName !== null && item.characterName.length > 0) {
        lines.push({ label: '角色', value: item.characterName })
    }
    if (item.loreName !== null && item.loreName.length > 0) {
        lines.push({ label: '设定', value: item.loreName })
    }
    if (lines.length === 0) {
        lines.push({ label: '来源', value: '未关联' })
    }
    return lines
}

interface ImageDetailDialogProps {
    /** 当前查看的图片：null 表示关闭 */
    image: MediaItem | null
    onOpenChange: (isOpen: boolean) => void
    onSetCover: (image: MediaItem) => void
    onCopyImage: (image: MediaItem) => void
    onInsertImage: (image: MediaItem) => void
    onDelete: (image: MediaItem) => void
}

export function ImageDetailDialog({
    image,
    onOpenChange,
    onSetCover,
    onCopyImage,
    onInsertImage,
    onDelete,
}: ImageDetailDialogProps): JSX.Element {
    const contentRef = useRef<HTMLDivElement>(null)
    const { detail, isLoading } = useImageDetail(image === null ? null : image.id)

    /**
     * 打开时的初始焦点交给弹层容器：不拦截的话 Radix 会聚焦首个可聚焦元素，
     * 落在删除 / 复制按钮上会连带弹出 tooltip；交给容器后 Tab 仍能正常进入操作区。
     */
    const handleOpenAutoFocus = (event: Event): void => {
        event.preventDefault()
        contentRef.current?.focus()
    }

    const usageGroups = useMemo(() => groupUsages(detail?.usages ?? []), [detail])
    const originLines = useMemo(() => (image === null ? [] : toOriginLines(image)), [image])

    /** 参数行：比例与画风缺失时整行不渲染，不留下空白分隔符 */
    const detailMeta =
        image === null
            ? ''
            : [
                  image.ratio === null ? null : `${image.ratio.includes('x') ? '尺寸' : '比例'} ${image.ratio}`,
                  image.style === null ? null : `画风 ${image.style}`,
              ]
                  .filter((part) => part !== null)
                  .join(' · ')

    /** 参数区是否有可展示内容：索引里可能只落了部分字段，任一非空即展示 */
    const hasDetail =
        image !== null &&
        (image.prompt !== null || image.ratio !== null || image.style !== null || image.enhancedFrom !== null)

    /** 复制提示词：写入系统剪贴板，webview 需在点击事件内调用 */
    const handleCopyPrompt = async (prompt: string): Promise<void> => {
        try {
            await navigator.clipboard.writeText(prompt)
            toast.success('提示词已复制')
        } catch {
            toast.error('复制失败，请手动选中文本')
        }
    }

    /** 详情副标题：类型、出处与生成时间，缺失项直接省略 */
    const subtitle = image === null ? '' : [formatDateTime(image.createdAt), image.path].filter(Boolean).join(' · ')

    return (
        <Dialog open={image !== null} onOpenChange={onOpenChange}>
            <DialogContent
                ref={contentRef}
                tabIndex={-1}
                className="flex max-h-[calc(100vh-4rem)] flex-col gap-3 sm:max-w-2xl"
                onOpenAutoFocus={handleOpenAutoFocus}
            >
                {image === null ? null : (
                    <>
                        {/* 标题右侧让出关闭按钮的位置，长文件名不会压到 X 上 */}
                        <DialogHeader className="pr-8">
                            <DialogTitle className="text-lg">图片详情</DialogTitle>
                            <DialogDescription className="break-all">{subtitle}</DialogDescription>
                        </DialogHeader>
                        <div className="min-h-0 flex-1 overflow-y-auto">
                            <Image
                                src={image.url}
                                alt={originLines.map((line) => line.value).join(' ')}
                                aspect="auto"
                                size="lg"
                                loading="eager"
                                className="max-h-[45vh] w-full object-contain"
                            />
                            <div className="mt-3 flex flex-col gap-3">
                                <section className="flex flex-col gap-1">
                                    <h3 className="text-xs font-medium">出处</h3>
                                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                                        {originLines.map((line) => (
                                            <div key={line.label} className="contents">
                                                <dt className="text-muted-foreground">{line.label}</dt>
                                                <dd className="truncate">{line.value}</dd>
                                            </div>
                                        ))}
                                        <dt className="text-muted-foreground">生成</dt>
                                        <dd>{formatDateTime(image.createdAt)}</dd>
                                    </dl>
                                    {detailMeta.length === 0 ? null : (
                                        <p className="text-muted-foreground text-xs">{detailMeta}</p>
                                    )}
                                </section>

                                {isLoading ? (
                                    <div className="flex flex-col gap-1.5">
                                        <Skeleton className="h-4 w-24" />
                                        <Skeleton className="h-10 w-full" />
                                    </div>
                                ) : (
                                    <section className="flex flex-col gap-1.5">
                                        <h3 className="text-xs font-medium">
                                            引用
                                            <span className="text-muted-foreground ml-1 tabular-nums">
                                                {detail?.usages.length ?? 0}
                                            </span>
                                        </h3>
                                        {usageGroups.length === 0 ? (
                                            <p className="bg-muted text-muted-foreground rounded-md p-2 text-xs">
                                                暂未被使用
                                            </p>
                                        ) : (
                                            <ul className="flex flex-col gap-1">
                                                {usageGroups.map((group) => (
                                                    <li key={group.refType} className="flex flex-col gap-0.5">
                                                        <span className="text-muted-foreground text-[11px]">
                                                            {group.label}
                                                        </span>
                                                        {group.items.map((usage) => (
                                                            <span
                                                                key={`${usage.refType}-${usage.refPath}-${usage.refId ?? ''}`}
                                                                className="bg-muted/40 flex items-center gap-1.5 rounded-md px-2 py-1 text-xs"
                                                            >
                                                                <ExternalLink className="text-muted-foreground size-3 shrink-0" />
                                                                <span className="truncate">
                                                                    {usage.refTitle ?? usage.refPath}
                                                                </span>
                                                                <span className="text-muted-foreground ml-auto shrink-0 truncate text-[11px]">
                                                                    {usage.refPath}
                                                                </span>
                                                            </span>
                                                        ))}
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </section>
                                )}

                                <section className="flex flex-col gap-1.5">
                                    <div className="flex items-center gap-1">
                                        <h3 className="text-xs font-medium">出图参数</h3>
                                        {hasDetail && image.prompt !== null ? (
                                            <Button
                                                size="xs"
                                                variant="ghost"
                                                className="ml-auto"
                                                onClick={() => {
                                                    if (image.prompt !== null) {
                                                        void handleCopyPrompt(image.prompt)
                                                    }
                                                }}
                                            >
                                                <Copy />
                                                复制提示词
                                            </Button>
                                        ) : null}
                                    </div>
                                    {hasDetail ? (
                                        <>
                                            {image.prompt === null ? null : (
                                                <p className="bg-muted/40 rounded-md p-2 text-xs leading-5 whitespace-pre-wrap break-all">
                                                    {image.prompt}
                                                </p>
                                            )}
                                            {image.enhancedFrom === null ? null : (
                                                <p className="bg-muted/40 text-muted-foreground rounded-md p-2 text-xs leading-5 whitespace-pre-wrap break-all">
                                                    增强前：{image.enhancedFrom}
                                                </p>
                                            )}
                                        </>
                                    ) : (
                                        <p className="bg-muted text-muted-foreground rounded-md p-2 text-xs">
                                            没有出图参数
                                        </p>
                                    )}
                                </section>
                            </div>
                        </div>
                        <DialogFooter className="flex-wrap items-center gap-2 sm:justify-between">
                            <Button
                                size="icon"
                                variant="destructive"
                                tooltip="删除图片"
                                onClick={() => onDelete(image)}
                            >
                                <Trash2 />
                            </Button>
                            <div className="flex flex-wrap items-center justify-end gap-2">
                                <Button variant="outline" onClick={() => onCopyImage(image)}>
                                    <Copy />
                                    复制图片
                                </Button>
                                <Button variant="outline" onClick={() => onInsertImage(image)}>
                                    <TextCursorInput />
                                    插入到文章
                                </Button>
                                <Button onClick={() => onSetCover(image)}>设为作品封面</Button>
                            </div>
                        </DialogFooter>
                    </>
                )}
            </DialogContent>
        </Dialog>
    )
}
