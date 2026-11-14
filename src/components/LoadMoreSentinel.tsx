/**
 * 续载哨兵：滚动进入视口即上报加载意图，观察与解绑由 useScrollSentinel 负责。
 * 复用约定：与 @webview/hooks/useScrollSentinel 成对使用——hook 给出 ref，本组件负责哨兵 DOM 与转圈；
 * 转圈取 @components/ui/spinner。
 * 关键约束：未加载时用 invisible 而非条件渲染——转圈出现/消失会让列表高度跳动；
 * ref 必须挂在始终存在的 div 上，否则 hook 拿不到观察目标。
 */
'use client'

import { Spinner } from '@components/ui/spinner'
import type { JSX, RefObject } from 'react'

export interface LoadMoreSentinelProps {
    /** 由 useScrollSentinel 返回的哨兵 ref：必须挂在真实 DOM 上 */
    sentinelRef: RefObject<HTMLDivElement | null>
    /** 是否正在加载下一批：为真时显示转圈，否则隐形占位 */
    isLoading: boolean
}

export function LoadMoreSentinel({ sentinelRef, isLoading }: LoadMoreSentinelProps): JSX.Element {
    return (
        <div ref={sentinelRef} className="flex justify-center py-2">
            <Spinner className={isLoading ? 'size-4 text-muted-foreground' : 'invisible'} />
        </div>
    )
}
