/**
 * 封面弹窗：选图 → 按公众号首图比例（2.35:1）裁剪 → 保存到当前批次目录的 images/ 下。
 * 复用约定：骨架取 FormDialog（取消/保存与提交中禁用由它统一），当前封面预览复用 components/Image，
 * 缩放缓动取 @components/ui 的 slider，选图与落盘走 useWechatIssues 的 pickCover / readCoverSource / saveArticleCover。
 * 关键约束：裁剪全程在 Webview 内完成——原图必须由宿主读成 data URI 再送入，asWebviewUri 与页面不同源，
 * 直接 drawImage 会污染画布、导出时抛 SecurityError；导出按取景框坐标换算回原图，固定输出 1175×500 的 jpeg；
 * 缩放只改变取景比例，平移边界按「图片始终铺满取景框」收敛，避免裁出留白；
 * 没有选中新图时不能保存，避免把占位图当成封面写进批次目录。
 */
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Field, FieldDescription, FieldLabel } from '@components/ui/field'
import { Slider } from '@components/ui/slider'
import type { WechatArticleSummary } from '@shared/types/wechat'
import { Button } from '@webview/components/Button'
import { FormDialog } from '@webview/components/FormDialog'
import { Image } from '@webview/components/Image'
import type { JSX, PointerEvent } from 'react'

/** 输出尺寸：公众号首图推荐 2.35:1，1175×500 兼顾清晰度与素材体积 */
const OUTPUT_WIDTH = 1175
const OUTPUT_HEIGHT = 500

/** 缩放区间：1 表示图片恰好铺满取景框，上限给到 3 倍便于避开边角杂物 */
const ZOOM_MIN = 1
const ZOOM_MAX = 3

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
    /** 选择并读取原图：取消或失败返回 null */
    onPickImage: () => Promise<string | null>
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
    onPickImage,
    onSubmit,
}: WechatCoverDialogProps): JSX.Element {
    /** 待裁剪的原图：data URI，为空表示还没选图 */
    const [sourceUrl, setSourceUrl] = useState<string | null>(null)
    const [zoom, setZoom] = useState(ZOOM_MIN)
    const [offset, setOffset] = useState({ x: 0, y: 0 })
    const [isPicking, setIsPicking] = useState(false)
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

    const handlePick = async (): Promise<void> => {
        setIsPicking(true)
        const dataUrl = await onPickImage()
        setIsPicking(false)
        if (dataUrl === null) {
            return
        }
        setSourceUrl(dataUrl)
        setZoom(ZOOM_MIN)
        setOffset({ x: 0, y: 0 })
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
        <FormDialog
            open
            title="封面"
            description="按公众号首图比例 2.35:1 裁剪，结果保存到当前批次目录的 images/ 下。"
            submitLabel="保存封面"
            isSubmitting={isSubmitting}
            isSubmitDisabled={sourceUrl === null || isPicking}
            contentClassName="sm:max-w-md"
            onOpenChange={onOpenChange}
            onSubmit={handleSubmit}
        >
            <Field>
                <FieldLabel>封面图</FieldLabel>
                {sourceUrl === null ? (
                    <div className="flex flex-col gap-2">
                        <Image
                            src={coverUri}
                            alt={article.title}
                            aspect="2.35/1"
                            className="w-full rounded-lg bg-muted/40"
                            loading="eager"
                        />
                        <Button
                            variant="outline"
                            size="sm"
                            isLoading={isPicking}
                            disabled={isSubmitting}
                            onClick={() => void handlePick()}
                        >
                            选择图片
                        </Button>
                    </div>
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
                            <Button
                                variant="ghost"
                                size="sm"
                                isLoading={isPicking}
                                disabled={isSubmitting}
                                onClick={() => void handlePick()}
                            >
                                换一张
                            </Button>
                        </div>
                    </div>
                )}
                <FieldDescription>拖动取景框内的图片调整位置，滑杆控制缩放；只支持 jpg / png。</FieldDescription>
            </Field>
        </FormDialog>
    )
}
