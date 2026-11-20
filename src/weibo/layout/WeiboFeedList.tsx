/**
 * 信息流列表：加载态、空态、卡片列表与「加载更多 / 到底」三段式统一在此。
 * 复用约定：单条渲染交给 WeiboPostCard，加载态与空态复用 StateEmpty，
 * 页面只给出状态与回调，不再各自拼列表骨架。
 * 关键约束：加载态与空态互斥，加载中不渲染空态措辞；
 * 到底后不再渲染加载更多按钮，避免反复点击打出空请求；
 * emptyState 优先级最高，未配置 Cookie、未选分组等场景由页面给出更精确的引导。
 */
import { Inbox } from 'lucide-react'
import type { WeiboTimelinePost } from '@shared/types/weibo'
import { Button } from '@webview/components/Button'
import { StateEmpty } from '@webview/components/StateEmpty'
import { WeiboPostCard } from './WeiboPostCard'
import type { JSX, ReactNode } from 'react'

interface WeiboFeedListProps {
    posts: WeiboTimelinePost[]
    isLoading: boolean
    isLoadingMore: boolean
    hasMore: boolean
    emptyTitle?: string
    emptyDescription?: string
    /** 空态覆盖：优先级高于 emptyTitle / emptyDescription */
    emptyState?: ReactNode
    /** 空态的重试入口：给出时在默认空态下渲染「刷新」按钮 */
    onRefresh?: () => void
    onLoadMore: () => void
}

export function WeiboFeedList({
    posts,
    isLoading,
    isLoadingMore,
    hasMore,
    emptyTitle,
    emptyDescription,
    emptyState,
    onRefresh,
    onLoadMore,
}: WeiboFeedListProps): JSX.Element {
    if (isLoading) {
        return <StateEmpty className="py-8" title="正在读取微博..." isLoading />
    }
    if (posts.length === 0) {
        if (emptyState !== undefined) {
            return <>{emptyState}</>
        }
        return (
            <StateEmpty className="py-8" icon={Inbox} title={emptyTitle ?? '没有内容'} description={emptyDescription}>
                {onRefresh === undefined ? null : (
                    <Button size="sm" variant="outline" onClick={onRefresh}>
                        刷新
                    </Button>
                )}
            </StateEmpty>
        )
    }
    return (
        <>
            {posts.map((post) => (
                <WeiboPostCard key={post.id} post={post} />
            ))}
            <div className="flex justify-center py-2">
                {hasMore ? (
                    <Button
                        size="sm"
                        variant="outline"
                        isLoading={isLoadingMore}
                        onClick={() => {
                            onLoadMore()
                        }}
                    >
                        加载更多
                    </Button>
                ) : (
                    <span className="text-muted-foreground text-xs">已经到底了</span>
                )}
            </div>
        </>
    )
}
