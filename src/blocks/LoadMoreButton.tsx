/**
 * 续载按钮：把「加载更多」的文案与点击出口收敛到一处，供分批渲染的列表共用。
 * 复用约定：按钮取 components/Button，调用方给出剩余条数与点击回调，可按场景覆盖文案、变体与类名；
 * 关键约束：只在还有更多条目时由调用方渲染本组件，本组件不判断是否到达末尾，也不发起请求。
 */
import { Button } from '@webview/components/Button'
import type { ComponentProps, JSX } from 'react'

interface LoadMoreButtonProps {
    remaining: number
    onLoadMore: () => void
    label?: string
    variant?: ComponentProps<typeof Button>['variant']
    size?: ComponentProps<typeof Button>['size']
    className?: string
}

export function LoadMoreButton({
    remaining,
    onLoadMore,
    label,
    variant = 'outline',
    size = 'sm',
    className,
}: LoadMoreButtonProps): JSX.Element {
    return (
        <Button variant={variant} size={size} className={className} onClick={onLoadMore}>
            {label ?? `加载更多（还有 ${String(remaining)} 张）`}
        </Button>
    )
}
