/**
 * 图片展示：src 缺失或加载失败时退回占位图标，避免破图撑坏排版。
 * 复用约定：除展示相关属性外全部透传给原生 img，占位态与图片共用同一套外框类
 * （size-full + aspect 宽高比 + size 尺寸档位），缺图与正常加载的盒子保持一致。
 * 关键约束：失败记录绑定具体 src，src 变更后自动重试，不会因一次失败永久占位；
 * 错误回调按当前 DOM 上的 src 校验，避免切图后旧节点迟到的 error 把新图误判为失败；
 * 宽高比与尺寸档位只能经 aspect / size 传入，类名在 ASPECT_CLASS、SIZE_CLASS 中逐个写全，
 * 动态拼接会被 Tailwind 漏扫；默认 size-full 铺满父容器，调用方在 className 里传 size-*（如 size-3.5）
 * 时由 cn 整组覆盖，父容器高度由内容决定的场景改传 w-full 即可，高度交给 aspect 解析；
 * 缺省按列表缩略图语义加载（lazy + async 解码），首屏大图需显式传 loading="eager"。
 */
'use client'

import { cn } from 'cn'
import { Image as ImageIcon } from 'lucide-react'
import { useState } from 'react'
import type { ComponentPropsWithoutRef, JSX, SyntheticEvent } from 'react'

type ImageAspect = 'square' | 'video' | 'auto' | '9/16' | '4/3' | '3/4' | '2/3'

type ImageSize = 'none' | 'sm' | 'md' | 'lg' | 'xl' | 'full'

interface ImageProps extends ComponentPropsWithoutRef<'img'> {
    /** 宽高比，默认正方形（头像与方形封面网格）；auto 表示不约束比例，交给图片自身或外层容器 */
    aspect?: ImageAspect
    /** 外观尺寸档位，当前落为主题圆角令牌，默认 none（圆角交给外层容器）；className 里再写 rounded-* 可覆盖 */
    size?: ImageSize
}

/** 宽高比类名：必须逐个写全字面量，动态拼接的类名 Tailwind 扫不到会直接丢失 */
const ASPECT_CLASS: Record<ImageAspect, string> = {
    square: 'aspect-square',
    video: 'aspect-video',
    auto: 'aspect-auto',
    '9/16': 'aspect-9/16',
    '4/3': 'aspect-4/3',
    '3/4': 'aspect-3/4',
    '2/3': 'aspect-2/3',
}

/** 尺寸档位类名：同样必须写全字面量，且统一走主题 radius 令牌，不写裸 rounded 以免脱离主题 */
const SIZE_CLASS: Record<ImageSize, string> = {
    none: 'rounded-none',
    sm: 'rounded-sm',
    md: 'rounded-md',
    lg: 'rounded-lg',
    xl: 'rounded-xl',
    full: 'rounded-full',
}

export function Image({
    src,
    alt = '',
    aspect = 'square',
    size = 'none',
    className,
    onError,
    loading = 'lazy',
    decoding = 'async',
    ...props
}: ImageProps): JSX.Element {
    // 记录加载失败的 src，src 变更后自动重新尝试加载
    const [brokenSrc, setBrokenSrc] = useState<string | undefined>()
    const isBroken = !!src && brokenSrc === src
    // 两态共用的外框：铺满 + 宽高比 + 尺寸档位；className 最后合并，传 size-* 会整组覆盖 size-full
    const frameClass = cn('size-full', ASPECT_CLASS[aspect], SIZE_CLASS[size])

    function handleError(event: SyntheticEvent<HTMLImageElement>): void {
        // 只认当前 src 的失败：切图后旧节点迟到的 error 不应污染新图，也不该打扰调用方
        if (event.currentTarget.getAttribute('src') !== src) {
            return
        }
        setBrokenSrc(src)
        onError?.(event)
    }

    if (!src || isBroken) {
        return (
            <div
                role={alt ? 'img' : undefined}
                aria-label={alt || undefined}
                className={cn(
                    frameClass,
                    'flex items-center justify-center bg-muted/5 text-muted-foreground',
                    className,
                )}
            >
                <ImageIcon aria-hidden className="size-[50%] shrink-0 opacity-50" />
            </div>
        )
    }

    return (
        <img
            src={src}
            alt={alt}
            loading={loading}
            decoding={decoding}
            className={cn(frameClass, 'object-cover', className)}
            onError={handleError}
            {...props}
        />
    )
}
