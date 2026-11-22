/**
 * 微博头像：进入视口后才经宿主代理取图，无直链 / 加载中 / 失败都回落首字占位。
 * 复用约定：尺寸与字号由调用方经 className 给（帖子 40px、评论 28px），本组件只做尺寸透传；
 * 图片地址已在宿主按图床白名单收窄，前端不接触任意外链。
 * 关键约束：占位与图片两侧都要保持同一尺寸，避免列表随加载抖动。
 */
import { useHasEnteredViewport } from '@webview/hooks/useHasEnteredViewport'
import type { JSX } from 'react'
import { useWeiboImage } from '../hooks/useWeiboImage'

interface WeiboAvatarProps {
    name: string
    avatarUrl: string
    /** 尺寸与字号类名，如 `size-10` / `size-7 text-xs` */
    className?: string
}

export function WeiboAvatar({ name, avatarUrl, className }: WeiboAvatarProps): JSX.Element {
    const { ref, hasEntered } = useHasEnteredViewport()
    const { localUrl, isFailed } = useWeiboImage(hasEntered ? avatarUrl : '')
    const sizeClass = className ?? 'size-10'
    const initial = name.slice(0, 1)
    const fallbackClassName = `flex shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground ${sizeClass}`

    if (avatarUrl.length === 0 || isFailed) {
        return (
            <span aria-hidden className={fallbackClassName}>
                {initial}
            </span>
        )
    }
    if (localUrl === null) {
        return (
            <span ref={ref} aria-hidden className={fallbackClassName}>
                {initial}
            </span>
        )
    }
    return (
        <img
            src={localUrl}
            alt=""
            className={`shrink-0 rounded-full bg-muted object-cover ${sizeClass}`}
            loading="lazy"
        />
    )
}
