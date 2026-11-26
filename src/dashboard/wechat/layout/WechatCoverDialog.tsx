/**
 * 封面弹窗：在 Popover 选图面板里切换生图 / 在线图库 / 上传图片，挑中一张后按公众号首图比例（2.35:1）
 * 裁剪，再保存到当前批次目录的 images/ 下。
 * 复用约定：主弹层取 @webview/components/Dialog，选图面板统一取 components/ImagePicker（Popover + Tabs），
 * 缩略图取 components/Image，空态与加载态取 blocks/StateEmpty，缩放缓动取 @components/ui 的 slider；
 * 候选列表来自 useImagePickerSources（生图走 media/list、在线图库走 stock/downloaded、上传走 upload/list），
 * 只在 jpg/png 中挑选；读原图走 wechat/cover/source，保存走 wechat/article/cover。
 * 关键约束：选图面板复用上传页同一份清单，上传入口只在面板内提供，上传结果回选区但不直接设为封面；
 * 裁剪全程在 Webview 内完成，原图必须由宿主读成 data URI 再送入（asWebviewUri 与页面不同源，
 * 直接 drawImage 会污染画布、导出时抛 SecurityError）；导出按取景框坐标换算回原图，固定输出 1175×500 的 jpeg；
 * 缩放只改变取景比例，平移边界按「图片始终铺满取景框」收敛，避免裁出留白；
 * 没有选中新图时不能保存，未选时预览区展示文章当前封面，没有当前封面则提示先挑一张。
 */
import { cn } from 'cn'
import { Images } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Field, FieldGroup, FieldLabel } from '@components/ui/field'
import { Slider } from '@components/ui/slider'
import type { WechatArticleSummary } from '@shared/types/wechat'
import { StateEmpty } from '@webview/blocks/StateEmpty'
import { Button } from '@webview/components/Button'
import { Dialog } from '@webview/components/Dialog'
import { Image } from '@webview/components/Image'
import { ImagePicker } from '@webview/components/ImagePicker'
import { useImagePickerSources } from '@webview/hooks/useImagePickerSources'
import type { ImagePickerItem, ImageSourceKind } from '@webview/hooks/useImagePickerSources'
import type { JSX, PointerEvent } from 'react'

/** 输出尺寸：公众号首图推荐 2.35:1，1175×500 兼顾清晰度与素材体积 */
const OUTPUT_WIDTH = 1175
const OUTPUT_HEIGHT = 500

/** 缩放区间：1 表示图片恰好铺满取景框，上限给到 3 倍便于避开边角杂物 */
const ZOOM_MIN = 1
const ZOOM_MAX = 3

/** 裁剪只接受 jpg / png（与宿主 wechat/cover/source 的口径一致），其余格式在选图面板就滤掉 */
const COVER_EXTENSION = /\.(png|jpe?g)$/iu

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

export function WechatCoverDialog({
    article,
    coverUri,
    isSubmitting,
    onOpenChange,
    onReadImage,
    onSubmit,
}: WechatCoverDialogProps): JSX.Element {
    /** 选图面板开合：命中一张后立即收起 */
    const [isPickerOpen, setIsPickerOpen] = useState(false)
    /** 待裁剪的原图：data URI，为空表示还没选新图 */
    const [sourceUrl, setSourceUrl] = useState<string | null>(null)
    /** 已选条目的来源与路径：用于选图面板回显选中项 */
    const [selected, setSelected] = useState<{ kind: ImageSourceKind; path: string } | null>(null)
    const [zoom, setZoom] = useState(ZOOM_MIN)
    const [offset, setOffset] = useState({ x: 0, y: 0 })
    /** 正在读取原图：期间禁用点击与保存 */
    const [isReading, setIsReading] = useState(false)
    const frameRef = useRef<HTMLDivElement | null>(null)
    const imageRef = useRef<HTMLImageElement | null>(null)
    const dragRef = useRef<DragSnapshot | null>(null)
    /** 三来源候选清单与上传入口：封面只接受 jpg/png，其余格式在面板里滤掉 */
    const { sources, pickFiles, isUploading } = useImagePickerSources(COVER_EXTENSION)

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
    const applySource = (dataUrl: string, kind: ImageSourceKind, path: string): void => {
        setSourceUrl(dataUrl)
        setSelected({ kind, path })
        setZoom(ZOOM_MIN)
        setOffset({ x: 0, y: 0 })
    }

    /** 面板里点中一张：先读成 data URI（canvas 同源），成功后才收起面板 */
    function handleSelect(kind: ImageSourceKind, item: ImagePickerItem): void {
        if (isReading) {
            return
        }
        setIsReading(true)
        void onReadImage(item.path).then((dataUrl) => {
            setIsReading(false)
            if (dataUrl === null) {
                return
            }
            applySource(dataUrl, kind, item.path)
            setIsPickerOpen(false)
        })
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
            <Dialog size="full"
                open
                title="封面"
                confirmLabel="保存封面"
                isLoading={isSubmitting}
                isDisabled={sourceUrl === null || isReading}
                onOpenChange={onOpenChange}
                onConfirm={handleSubmit}
            >
                <FieldGroup>
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
                        <ImagePicker
                            open={isPickerOpen}
                            onOpenChange={setIsPickerOpen}
                            trigger={
                                <Button
                                    variant="outline"
                                    aria-label="选择封面图片"
                                    disabled={isSubmitting || isReading}
                                    className={cn(
                                        'w-full justify-start gap-2',
                                        selected !== null && 'border-primary text-primary',
                                    )}
                                >
                                    <Images className="size-4" aria-hidden="true" />
                                    <span className="text-xs font-medium">
                                        {selected === null ? '从生图 / 在线图库 / 上传图片中选择' : '重新选择封面图片'}
                                    </span>
                                </Button>
                            }
                            title="选择封面图片"
                            description="生图与在线图库挑一张，或直接上传本地图片后从上传图片里选。只接受 jpg / png。"
                            sources={sources}
                            selectedPaths={selected === null ? [] : [selected.path]}
                            isUploading={isUploading}
                            disabled={isSubmitting || isReading}
                            onUpload={pickFiles}
                            onSelect={(item, kind): void => handleSelect(kind, item)}
                        />
                    </Field>
                </FieldGroup>
            </Dialog>
        </>
    )
}
