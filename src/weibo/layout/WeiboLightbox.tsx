/**
 * 图片预览浮层：列表展示中等尺寸，点击后按需再取原图放大。
 * 复用约定：图片仍经 useWeiboImage 走宿主代理换 data URI，不直连图床；
 * 原图请求失败或超过内联上限时自动回退到中图，并在角标里标明尺寸来源。
 * 关键约束：关闭按钮固定在屏幕右上角、尺寸角标固定在左上角，二者都不随图片尺寸移动；
 * 竖图按高度铺满、横图按宽度铺满，加载完成前先用 contain 兜底避免溢出；
 * 点击图片本身不关闭，点击图片外的遮罩区域或按 Esc 关闭。
 */
import { X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Spinner } from '@components/ui/spinner'
import type { WeiboTimelineImageSize } from '@shared/types/weibo'
import type { JSX, MouseEvent, SyntheticEvent } from 'react'
import { useWeiboImage } from '../hooks/useWeiboImage'

interface WeiboLightboxProps {
    /** 原图地址：优先请求 */
    originUrl: string
    /** 中图地址：原图失败时的回退 */
    thumbUrl: string
    /** 上游 largest 档的尺寸：角标与竖横判断都以它为准，与实际加载的档位无关 */
    originalSize: WeiboTimelineImageSize | null
    onClose: () => void
}

export function WeiboLightbox({ originUrl, thumbUrl, originalSize, onClose }: WeiboLightboxProps): JSX.Element {
    const origin = useWeiboImage(originUrl)
    // 原图失败后才请求中图：两者都走同一份模块级缓存，不会重复下载
    const fallback = useWeiboImage(origin.isFailed ? thumbUrl : '')
    const displayUrl = origin.localUrl ?? fallback.localUrl
    /** 解码后的实际尺寸：仅在上游没给尺寸时兜底 */
    const [decodedSize, setDecodedSize] = useState<WeiboTimelineImageSize | null>(null)

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                onClose()
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return (): void => {
            window.removeEventListener('keydown', handleKeyDown)
        }
    }, [onClose])

    /** 解码尺寸只作兜底：上游给了 original 尺寸时一律以它为准 */
    const handleLoad = useCallback((event: SyntheticEvent<HTMLImageElement>): void => {
        const image = event.currentTarget
        setDecodedSize({ width: image.naturalWidth, height: image.naturalHeight })
    }, [])

    /** 点击图片与角标都不关闭，只有点遮罩或关闭按钮才关闭 */
    const handleContentClick = useCallback((event: MouseEvent<HTMLElement>): void => {
        event.stopPropagation()
    }, [])

    /** 关闭按钮自身也阻止冒泡：避免与遮罩的 onClose 叠加成两次关闭 */
    const handleCloseClick = useCallback(
        (event: MouseEvent<HTMLButtonElement>): void => {
            event.stopPropagation()
            onClose()
        },
        [onClose],
    )

    // 角标与竖横判断都用上游 original 档尺寸：预览实际加载哪一档都不影响展示值
    const displaySize = originalSize ?? decodedSize
    const isPortrait = displaySize !== null && displaySize.height > displaySize.width
    const imageClassName =
        displaySize === null
            ? 'max-h-full max-w-full object-contain'
            : isPortrait
              ? 'max-h-full w-auto'
              : 'max-w-full h-auto'
    const sizeLabel =
        originalSize !== null
            ? `最大 ${String(originalSize.width)} × ${String(originalSize.height)}`
            : displaySize === null
              ? '加载中…'
              : `${origin.isFailed ? '中图' : '实际'} ${String(displaySize.width)} × ${String(displaySize.height)}`

    return (
        <div role="presentation" className="fixed inset-0 z-50 bg-black/85" onClick={onClose}>
            <span
                className="absolute top-4 left-4 rounded bg-black/60 px-2 py-1 font-mono text-white/80 text-xs"
                onClick={handleContentClick}
            >
                {sizeLabel}
            </span>
            <button
                type="button"
                aria-label="关闭预览"
                className="absolute top-4 right-4 rounded-full bg-black/60 p-2 text-white transition-colors hover:bg-black/80"
                onClick={handleCloseClick}
            >
                <X className="size-5" aria-hidden="true" />
            </button>
            <div className="flex h-full w-full items-center justify-center p-12">
                {displayUrl === null ? (
                    <Spinner className="size-8 text-white" />
                ) : (
                    <img
                        src={displayUrl}
                        alt="微博原图"
                        className={imageClassName}
                        onClick={handleContentClick}
                        onLoad={handleLoad}
                    />
                )}
            </div>
            {origin.isFailed ? (
                <p className="absolute inset-x-0 bottom-4 text-center text-white/70 text-xs">
                    原图过大或加载失败，已显示中等尺寸
                </p>
            ) : null}
        </div>
    )
}
