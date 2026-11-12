/**
 * 封面弹窗：先按来源打开选图对话框（生图结果 / 在线图片 / 已上传图片），挑中一张后按公众号首图比例（2.35:1）
 * 裁剪，再保存到当前批次目录的 images/ 下。
 * 复用约定：骨架取 FormDialog，选图表单取 @components/ui 的 dialog，来源入口与缩略图取 components/Button 与
 * components/Image，空态与加载态取 components/StateEmpty，缩放缓动取 @components/ui 的 slider；
 * 候选列表来自 useWechatCoverSources（生图走 media/list、在线图片走 stock/downloaded、已上传走 upload/list），
 * 读原图走 wechat/cover/source，保存走 wechat/article/cover。
 * 关键约束：封面本身不再直接调起文件对话框——本地上传只经由「已上传图片」来源，与上传页共用同一份清单；
 * 裁剪全程在 Webview 内完成，原图必须由宿主读成 data URI 再送入（asWebviewUri 与页面不同源，
 * 直接 drawImage 会污染画布、导出时抛 SecurityError）；导出按取景框坐标换算回原图，固定输出 1175×500 的 jpeg；
 * 缩放只改变取景比例，平移边界按「图片始终铺满取景框」收敛，避免裁出留白；
 * 没有选中新图时不能保存，未选时预览区展示文章当前封面，没有当前封面则提示先挑一张。
 */
import { cn } from 'cn'
import { Check, LibraryBig, Sparkles, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@components/ui/dialog'
import { Field, FieldLabel } from '@components/ui/field'
import { Slider } from '@components/ui/slider'
import type { WechatArticleSummary } from '@shared/types/wechat'
import { Button } from '@webview/components/Button'
import { FormDialog } from '@webview/components/FormDialog'
import { Image } from '@webview/components/Image'
import { StateEmpty } from '@webview/components/StateEmpty'
import { useRenderLimit } from '@webview/hooks/useRenderLimit'
import type { JSX, PointerEvent, ReactNode } from 'react'
import { useWechatCoverSources, type CoverSourceImage, type CoverSourceKind } from '../hooks/useWechatCoverSources'

/** 输出尺寸：公众号首图推荐 2.35:1，1175×500 兼顾清晰度与素材体积 */
const OUTPUT_WIDTH = 1175
const OUTPUT_HEIGHT = 500

/** 缩放区间：1 表示图片恰好铺满取景框，上限给到 3 倍便于避开边角杂物 */
const ZOOM_MIN = 1
const ZOOM_MAX = 3

/** 选图对话框每批展示的张数：图库可能有上千张，按需增量渲染避免一次挂满 DOM */
const PICKER_PAGE_SIZE = 60

/** 来源元信息：入口按钮与选图对话框标题都取自同一份定义 */
interface CoverSourceMeta {
    label: string
    icon: (props: { className?: string }) => ReactNode
    dialogTitle: string
    emptyTitle: string
}

const SOURCE_META: Record<CoverSourceKind, CoverSourceMeta> = {
    generate: {
        label: '生图结果',
        icon: Sparkles,
        dialogTitle: '选择生图结果',
        emptyTitle: '还没有生图结果',
    },
    stock: {
        label: '在线图片',
        icon: LibraryBig,
        dialogTitle: '选择在线图片',
        emptyTitle: '还没有已下载的在线图片',
    },
    upload: {
        label: '已上传图片',
        icon: Upload,
        dialogTitle: '选择已上传图片',
        emptyTitle: '还没有上传过图片',
    },
}

/** 入口顺序：与来源定义分开，保证界面顺序稳定 */
const SOURCE_ORDER: readonly CoverSourceKind[] = ['generate', 'stock', 'upload']

/** 拖动中的起点快照：指针坐标与当时的偏移，移动时按差值累加 */
interface DragSnapshot {
    startX: number
    startY: number
    originX: number
    originY: number
}

interface WechatCoverDialogProps {
    /** 目标文章：标题用作占位图的替代文本，id 决定落盘文件名 */
    article: WechatArticleSummary
    /** 当前封面的 Webview 地址：未选新图时作为预览，缺省显示占位 */
    coverUri?: string
    isSubmitting: boolean
    onOpenChange: (open: boolean) => void
    /** 读取库内图片：三个来源共用，失败返回 null */
    onReadImage: (path: string) => Promise<string | null>
    /** 保存裁剪结果：返回 false 表示失败，弹窗保持打开 */
    onSubmit: (dataUrl: string) => Promise<boolean>
}

/** 把偏移收敛到「图片始终铺满取景框」的范围内 */
function clamp(value: number, limit: number): number {
    return Math.min(Math.max(value, -limit), limit)
}

interface CoverSourcePickerDialogProps {
    kind: CoverSourceKind
    /** 已选中的库内路径：回到同一来源时高亮上次选中的那张 */
    selectedPath: string | null
    /** 正在读取原图：期间禁用点击，避免连点产生多次读盘 */
    isReading: boolean
    onSelect: (item: CoverSourceImage) => void
    onOpenChange: (open: boolean) => void
}

/** 选图对话框：列出当前来源的全部图片，按「加载更多」增量渲染，点一张即回填封面 */
function CoverSourcePickerDialog({
    kind,
    selectedPath,
    isReading,
    onSelect,
    onOpenChange,
}: CoverSourcePickerDialogProps): JSX.Element {
    const meta = SOURCE_META[kind]
    const { items, isLoading } = useWechatCoverSources(kind)
    const { limit, hasMore, remaining, loadMore } = useRenderLimit(items.length, PICKER_PAGE_SIZE)
    const visibleItems = items.slice(0, limit)

    return (
        <Dialog open onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle className="text-lg">{meta.dialogTitle}</DialogTitle>
                </DialogHeader>
                {isLoading ? (
                    <StateEmpty isLoading title="正在读取图片" className="gap-2 py-10" />
                ) : items.length === 0 ? (
                    <StateEmpty title={meta.emptyTitle} className="gap-2 py-10" />
                ) : (
                    <div className="flex flex-col gap-2">
                        <div className="grid max-h-[50vh] grid-cols-3 gap-2 overflow-y-auto">
                            {visibleItems.map((item) => {
                                const isSelected = item.path === selectedPath
                                return (
                                    <Button
                                        key={item.id}
                                        variant="ghost"
                                        aria-label={item.alt}
                                        aria-pressed={isSelected}
                                        disabled={isReading}
                                        className={cn(
                                            'group h-auto w-full rounded-md p-0',
                                            isSelected && 'ring-2 ring-primary',
                                        )}
                                        onClick={() => onSelect(item)}
                                    >
                                        <Image src={item.url} size="sm" className="w-full bg-muted" />
                                        {/* 悬停与键盘聚焦时压一层 20% 黑遮罩并亮出选择图标，点哪张一目了然 */}
                                        <span
                                            aria-hidden
                                            className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-sm bg-black/20 opacity-0 transition-opacity group-focus-visible:opacity-100 group-hover:opacity-100"
                                        >
                                            <span className="flex size-8 items-center justify-center rounded-full bg-primary/70 text-primary-foreground">
                                                <Check className="size-4" />
                                            </span>
                                        </span>
                                    </Button>
                                )
                            })}
                        </div>
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-xs text-muted-foreground">{`共 ${String(items.length)} 张`}</span>
                            {hasMore ? (
                                <Button variant="outline" size="sm" disabled={isReading} onClick={loadMore}>
                                    {`加载更多（还有 ${String(remaining)} 张）`}
                                </Button>
                            ) : null}
                        </div>
                    </div>
                )}
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        取消
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

export function WechatCoverDialog({
    article,
    coverUri,
    isSubmitting,
    onOpenChange,
    onReadImage,
    onSubmit,
}: WechatCoverDialogProps): JSX.Element {
    /** 正在挑图的来源：非 null 即打开选图对话框 */
    const [pickerKind, setPickerKind] = useState<CoverSourceKind | null>(null)
    /** 待裁剪的原图：data URI，为空表示还没选新图 */
    const [sourceUrl, setSourceUrl] = useState<string | null>(null)
    /** 已选条目的来源与路径：用于入口按钮高亮与选图对话框回显选中项 */
    const [selected, setSelected] = useState<{ kind: CoverSourceKind; path: string } | null>(null)
    const [zoom, setZoom] = useState(ZOOM_MIN)
    const [offset, setOffset] = useState({ x: 0, y: 0 })
    /** 正在读取原图：期间禁用点击与保存 */
    const [isReading, setIsReading] = useState(false)
    const frameRef = useRef<HTMLDivElement | null>(null)
    const imageRef = useRef<HTMLImageElement | null>(null)
    const dragRef = useRef<DragSnapshot | null>(null)

    /** 当前缩放下的最大平移量：取景框之外的图片部分才允许被拖进来 */
    const readOffsetLimit = (nextZoom: number): { x: number; y: number } => {
        const image = imageRef.current
        const frame = frameRef.current
        if (image === null || frame === null || image.naturalWidth === 0) {
            return { x: 0, y: 0 }
        }
        const rect = frame.getBoundingClientRect()
        const baseScale = Math.max(rect.width / image.naturalWidth, rect.height / image.naturalHeight)
        return {
            x: Math.max(0, (image.naturalWidth * baseScale * nextZoom - rect.width) / 2),
            y: Math.max(0, (image.naturalHeight * baseScale * nextZoom - rect.height) / 2),
        }
    }

    /** 缩放后立即收敛偏移：放大会露出空白，缩小时原偏移可能越界 */
    const applyZoom = (nextZoom: number): void => {
        const limit = readOffsetLimit(nextZoom)
        setZoom(nextZoom)
        setOffset((previous) => ({
            x: clamp(previous.x, limit.x),
            y: clamp(previous.y, limit.y),
        }))
    }

    /** 换上新原图：缩放与偏移回到初始，避免沿用上一张的取景 */
    const applySource = (dataUrl: string, kind: CoverSourceKind, item: CoverSourceImage): void => {
        setSourceUrl(dataUrl)
        setSelected({ kind, path: item.path })
        setZoom(ZOOM_MIN)
        setOffset({ x: 0, y: 0 })
    }

    /** 选图对话框里点中一张：先读成 data URI（canvas 同源），成功后才关闭对话框 */
    const handleSelect = async (kind: CoverSourceKind, item: CoverSourceImage): Promise<void> => {
        if (isReading) {
            return
        }
        setIsReading(true)
        const dataUrl = await onReadImage(item.path)
        setIsReading(false)
        if (dataUrl === null) {
            return
        }
        applySource(dataUrl, kind, item)
        setPickerKind(null)
    }

    const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
        if (event.button !== 0) {
            return
        }
        event.currentTarget.setPointerCapture(event.pointerId)
        dragRef.current = {
            startX: event.clientX,
            startY: event.clientY,
            originX: offset.x,
            originY: offset.y,
        }
    }

    const handlePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
        const drag = dragRef.current
        if (drag === null) {
            return
        }
        const limit = readOffsetLimit(zoom)
        setOffset({
            x: clamp(drag.originX + (event.clientX - drag.startX), limit.x),
            y: clamp(drag.originY + (event.clientY - drag.startY), limit.y),
        })
    }

    const handlePointerUp = (event: PointerEvent<HTMLDivElement>): void => {
        dragRef.current = null
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
        }
    }

    /**
     * 合成裁剪结果：取景框坐标先平移到图片左上角，再按输出宽度等比缩放。
     * 关键约束：图片未加载完时返回 null——此时 naturalWidth 为 0，画出来只会是一张空白。
     */
    const buildCroppedDataUrl = (): string | null => {
        const image = imageRef.current
        const frame = frameRef.current
        if (image === null || frame === null || !image.complete || image.naturalWidth === 0) {
            return null
        }
        const rect = frame.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) {
            return null
        }
        const baseScale = Math.max(rect.width / image.naturalWidth, rect.height / image.naturalHeight)
        const drawWidth = image.naturalWidth * baseScale * zoom
        const drawHeight = image.naturalHeight * baseScale * zoom
        const left = (rect.width - drawWidth) / 2 + offset.x
        const top = (rect.height - drawHeight) / 2 + offset.y
        const canvas = document.createElement('canvas')
        canvas.width = OUTPUT_WIDTH
        canvas.height = OUTPUT_HEIGHT
        const context = canvas.getContext('2d')
        if (context === null) {
            return null
        }
        const ratio = OUTPUT_WIDTH / rect.width
        context.drawImage(image, left * ratio, top * ratio, drawWidth * ratio, drawHeight * ratio)
        return canvas.toDataURL('image/jpeg', 0.92)
    }

    const handleSubmit = (): void => {
        const dataUrl = buildCroppedDataUrl()
        if (dataUrl === null) {
            toast.error('图片还没准备好，请重新选择封面')
            return
        }
        void onSubmit(dataUrl).then((isSaved) => {
            if (isSaved) {
                onOpenChange(false)
            }
        })
    }

    return (
        <>
            <FormDialog
                open
                title="封面"
                submitLabel="保存封面"
                isSubmitting={isSubmitting}
                isSubmitDisabled={sourceUrl === null || isReading}
                contentClassName="sm:max-w-lg"
                onOpenChange={onOpenChange}
                onSubmit={handleSubmit}
            >
                <Field>
                    <FieldLabel>封面预览</FieldLabel>
                    {sourceUrl === null ? (
                        coverUri === undefined ? (
                            <StateEmpty
                                title="尚未选择封面"
                                className="aspect-[2.35/1] gap-1 rounded-lg border border-dashed p-3"
                            />
                        ) : (
                            <Image
                                src={coverUri}
                                alt={article.title}
                                aspect="2.35/1"
                                className="w-full rounded-lg bg-muted/40"
                                loading="eager"
                            />
                        )
                    ) : (
                        <div className="flex flex-col gap-2">
                            <div
                                ref={frameRef}
                                className="relative aspect-[2.35/1] w-full cursor-grab touch-none overflow-hidden rounded-lg bg-muted/40 active:cursor-grabbing"
                                onPointerDown={handlePointerDown}
                                onPointerMove={handlePointerMove}
                                onPointerUp={handlePointerUp}
                                onPointerCancel={handlePointerUp}
                            >
                                <img
                                    ref={imageRef}
                                    src={sourceUrl}
                                    alt={article.title}
                                    draggable={false}
                                    className="absolute inset-0 size-full select-none object-cover"
                                    style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="shrink-0 text-xs text-muted-foreground">缩放</span>
                                <Slider
                                    value={[zoom]}
                                    min={ZOOM_MIN}
                                    max={ZOOM_MAX}
                                    step={0.01}
                                    disabled={isSubmitting}
                                    onValueChange={(value) => applyZoom(value[0] ?? ZOOM_MIN)}
                                />
                            </div>
                        </div>
                    )}
                </Field>
                <Field>
                    <FieldLabel>图片来源</FieldLabel>
                    <div className="grid grid-cols-3 gap-2">
                        {SOURCE_ORDER.map((value) => {
                            const meta = SOURCE_META[value]
                            const Icon = meta.icon
                            const isActive = selected?.kind === value
                            return (
                                <Button
                                    key={value}
                                    variant="outline"
                                    aria-label={`从${meta.label}中选择封面`}
                                    disabled={isSubmitting || isReading}
                                    className={cn(
                                        'h-auto flex-col gap-1 py-2.5',
                                        isActive && 'border-primary text-primary',
                                    )}
                                    onClick={() => setPickerKind(value)}
                                >
                                    <Icon className="size-4" />
                                    <span className="text-xs font-medium">{meta.label}</span>
                                </Button>
                            )
                        })}
                    </div>
                </Field>
            </FormDialog>
            {pickerKind === null ? null : (
                <CoverSourcePickerDialog
                    key={pickerKind}
                    kind={pickerKind}
                    selectedPath={selected?.kind === pickerKind ? selected.path : null}
                    isReading={isReading}
                    onSelect={(item) => void handleSelect(pickerKind, item)}
                    onOpenChange={(open) => {
                        if (!open) {
                            setPickerKind(null)
                        }
                    }}
                />
            )}
        </>
    )
}
