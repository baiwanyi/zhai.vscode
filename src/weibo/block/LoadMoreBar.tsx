/**
 * 列表底部的续载栏：自动续载为主入口，失败时同一按钮改文案重试，首屏失败只留整块重试。
 * 复用约定：按钮取 @webview/components/Button，文案与是否可续载由调用方给出，
 * 评论列表与转发列表共用同一套位置与禁用规则。
 * 关键约束：首屏失败（error 非空）时必须传 canLoadMore=false，否则会出现「续载」与「重试」两条并行路径；
 * 续载失败时游标不动，本栏只改按钮文案，不重置列表。
 */
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'

export interface LoadMoreBarProps {
    /** 是否允许续载：由「还有下一页」与「首屏无错误」共同决定 */
    canLoadMore: boolean
    isLoadingMore: boolean
    /** 续载失败：同一个按钮改为重试文案，游标不动 */
    hasLoadMoreError: boolean
    /** 首屏失败：与 !isLoading 一起决定是否显示整块重试 */
    error: string | null
    isLoading: boolean
    loadMoreLabel: string
    onLoadMore: () => void
    onReload: () => void
}

export function LoadMoreBar({
    canLoadMore,
    isLoadingMore,
    hasLoadMoreError,
    error,
    isLoading,
    loadMoreLabel,
    onLoadMore,
    onReload,
}: LoadMoreBarProps): JSX.Element {
    return (
        <div className="flex items-center gap-2">
            {canLoadMore ? (
                <Button size="xs" variant="ghost" onClick={onLoadMore} isLoading={isLoadingMore}>
                    {hasLoadMoreError ? '重试继续加载' : loadMoreLabel}
                </Button>
            ) : null}
            {error !== null && !isLoading ? (
                <Button size="xs" variant="outline" onClick={onReload}>
                    重试
                </Button>
            ) : null}
        </div>
    )
}
