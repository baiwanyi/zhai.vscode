/**
 * 封面裁剪几何：把取景框缩放、平移边界与画布导出收拢为不依赖 React 的纯计算。
 * 复用约定：只处理数值与 canvas，原图读取与状态更新由调用方负责；输出口径固定为 jpeg。
 * 关键约束：图片未加载、取景框零尺寸或画布被污染时返回 null，由调用方展示可提示的失败；
 * 平移边界按「图片始终铺满取景框」收敛，避免裁出留白。
 */
export interface CropRect {
    width: number
    height: number
}

export interface CropImageInfo {
    naturalWidth: number
    naturalHeight: number
    complete: boolean
}

export interface CropOffset {
    x: number
    y: number
}

/** 把偏移收敛到「图片始终铺满取景框」的范围内 */
export function clampOffset(value: number, limit: number): number {
    return Math.min(Math.max(value, -limit), limit)
}

/** 当前缩放下的最大平移量：取景框之外的图片部分才允许被拖进来 */
export function readOffsetLimit(image: CropImageInfo, frame: CropRect, zoom: number): CropOffset {
    if (image.naturalWidth === 0 || frame.width === 0 || frame.height === 0) {
        return { x: 0, y: 0 }
    }
    const baseScale = Math.max(frame.width / image.naturalWidth, frame.height / image.naturalHeight)
    return {
        x: Math.max(0, (image.naturalWidth * baseScale * zoom - frame.width) / 2),
        y: Math.max(0, (image.naturalHeight * baseScale * zoom - frame.height) / 2),
    }
}

/**
 * 合成裁剪结果：取景框坐标先平移到图片左上角，再按输出宽度等比缩放。
 * 关键约束：图片未加载完时返回 null——此时 naturalWidth 为 0，画出来只会是一张空白。
 */
export function buildCroppedDataUrl(
    image: HTMLImageElement,
    frame: CropRect,
    zoom: number,
    offset: CropOffset,
    outputWidth: number,
    outputHeight: number,
): string | null {
    if (!image.complete || image.naturalWidth === 0 || frame.width === 0 || frame.height === 0) {
        return null
    }
    const baseScale = Math.max(frame.width / image.naturalWidth, frame.height / image.naturalHeight)
    const drawWidth = image.naturalWidth * baseScale * zoom
    const drawHeight = image.naturalHeight * baseScale * zoom
    const left = (frame.width - drawWidth) / 2 + offset.x
    const top = (frame.height - drawHeight) / 2 + offset.y
    const canvas = document.createElement('canvas')
    canvas.width = outputWidth
    canvas.height = outputHeight
    const context = canvas.getContext('2d')
    if (context === null) {
        return null
    }
    const ratio = outputWidth / frame.width
    try {
        context.drawImage(image, left * ratio, top * ratio, drawWidth * ratio, drawHeight * ratio)
        return canvas.toDataURL('image/jpeg', 0.92)
    } catch {
        return null
    }
}
