/**
 * 续载哨兵：滚动进入视口即上报加载意图，观察与解绑由 useScrollSentinel 负责。
 * 复用约定：与 @webview/hooks/useScrollSentinel 成对使用——hook 给出 ref，本组件负责哨兵 DOM、转圈与失败重试；
 * 转圈取 @components/ui/spinner，失败后的重试按钮取 @webview/components/Button。
 * 关键约束：未加载时用 invisible 而非条件渲染——转圈出现/消失会让列表高度跳动；
 * ref 必须挂在始终存在的 div 上，否则 hook 拿不到观察目标；
 * 失败态只替换外层 div 内部的内容，哨兵节点本身保留；重试由调用方从当前游标续拉，不回到首页。
 */
'use client'

import { Spinner } from '@components/ui/spinner'
import { Button } from '@webview/components/Button'
import type { JSX, RefObject } from 'react'

export interface LoadMoreSentinelProps {
    /** 由 useScrollSentinel 返回的哨兵 ref：必须挂在真实 DOM 上 */
    sentinelRef: RefObject<HTMLDivElement | null>
    /** 是否正在加载下一批：为真时显示转圈，否则隐形占位 */
    isLoading: boolean
    /** 续载失败：为真时把转圈换成「加载失败 + 重试」 */
    hasError?: boolean
    /** 失败后重试：从当前游标继续加载 */
    onRetry?: () => void
    /** 失败提示文案：省略用默认值，列表可覆盖 */
    errorLabel?: string
    /** 重试按钮文案：省略用默认值 */
    retryLabel?: string
}

export function LoadMoreSentinel({
    sentinelRef,
    isLoading,
    hasError = false,
    onRetry,
    errorLabel = '加载失败',
    retryLabel = '重试',
}: LoadMoreSentinelProps): JSX.Element {
    return (
        <div ref={sentinelRef} className="flex justify-center py-2">
            {hasError && onRetry !== undefined ? (
                <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-xs">{errorLabel}</span>
                    <Button size="xs" variant="outline" onClick={onRetry}>
                        {retryLabel}
                    </Button>
                </div>
            ) : (
                <Spinner className={isLoading ? 'size-4 text-muted-foreground' : 'invisible'} />
            )}
        </div>
    )
}
