/**
 * 信息流列表：加载态、空态、卡片列表与「自动翻页 / 手动加载 / 到底」三段式统一在此。
 * 复用约定：单条渲染交给 WeiboPostCard，加载态与空态复用 StateEmpty，
 * 页面只给出状态与回调，不再各自拼列表骨架。
 * 关键约束：加载态与空态互斥，加载中不渲染空态措辞；
 * 滚动到底自动翻页，距底部一屏内即预取下一页，自动次数到上限（10 次）或有取数错误时
 * 退回「加载更多」按钮交还用户，避免长列表变成停不下来的请求链；
 * 到底后不再渲染加载更多按钮，避免反复点击打出空请求；
 * emptyState 优先级最高，未配置 Cookie、未选分组等场景由页面给出更精确的引导。
 */
import { Inbox } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { WeiboTimelinePost } from '@shared/types/weibo'
import { Button } from '@webview/components/Button'
import { StateEmpty } from '@webview/components/StateEmpty'
import { WeiboPostCard } from './WeiboPostCard'
import type { JSX, ReactNode } from 'react'

/** 自动翻页上限：连续自动加载到该次数后不再自动，交还用户手动点 */
const MAX_AUTO_LOADS = 10

/** 预取提前量：距底部一屏内就开始下一页，滚动不必等到底 */
const AUTO_LOAD_MARGIN = '240px'

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
    /** 取数错误：非空时暂停自动翻页，避免失败后反复重试打同一接口 */
    errorMessage?: string | null
    /** 屏蔽该博主：交给面板写入屏蔽名单，卡片「更多」菜单据此渲染入口 */
    onBlockAuthor?: (authorName: string) => void
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
    errorMessage = null,
    onBlockAuthor,
    onLoadMore,
}: WeiboFeedListProps): JSX.Element {
    const sentinelRef = useRef<HTMLDivElement | null>(null)
    /** 已自动触发的翻页次数：刷新替换内容时回到 0，重新给足自动额度 */
    const [autoLoadCount, setAutoLoadCount] = useState(0)
    /** 自动翻页的单飞标记：observer 连发与严格模式双跑都在这里被拦掉 */
    const isAutoPendingRef = useRef(false)
    /** 回调走 ref：观察器不必因父级每次渲染换函数而重建 */
    const onLoadMoreRef = useRef(onLoadMore)
    onLoadMoreRef.current = onLoadMore
    /** 上一次的条数：变短说明刷新替换了整条流，自动额度随之重置 */
    const prevPostCountRef = useRef(posts.length)

    useEffect(() => {
        if (posts.length < prevPostCountRef.current) {
            setAutoLoadCount(0)
        }
        prevPostCountRef.current = posts.length
    }, [posts.length])

    // 单飞标记在本轮加载结束后释放；加载失败时 errorMessage 会让观察器整体停摆，不会原地重试
    useEffect(() => {
        if (!isLoadingMore) {
            isAutoPendingRef.current = false
        }
    }, [isLoadingMore])

    const canAutoLoad = hasMore && errorMessage === null && autoLoadCount < MAX_AUTO_LOADS

    // 依赖里带上条数与加载态：一次翻页结束后重建观察器，哨兵仍在视口内时会立刻再触发下一页
    useEffect(() => {
        if (!canAutoLoad) {
            return
        }
        const node = sentinelRef.current
        if (node === null) {
            return
        }
        const observer = new IntersectionObserver(
            (entries) => {
                if (!entries.some((entry) => entry.isIntersecting) || isAutoPendingRef.current) {
                    return
                }
                isAutoPendingRef.current = true
                setAutoLoadCount((previous) => previous + 1)
                onLoadMoreRef.current()
            },
            { rootMargin: AUTO_LOAD_MARGIN },
        )
        observer.observe(node)
        return (): void => {
            observer.disconnect()
        }
    }, [canAutoLoad, isLoadingMore, posts.length])

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
    /** 自动额度用完或上一次取数失败：底部改出按钮，由用户决定是否继续翻 */
    const shouldWaitForManualLoad = autoLoadCount >= MAX_AUTO_LOADS || errorMessage !== null
    return (
        <>
            {posts.map((post) => (
                <WeiboPostCard key={post.id} post={post} onBlockAuthor={onBlockAuthor} />
            ))}
            <div ref={sentinelRef} className="flex justify-center py-2">
                {!hasMore ? (
                    <span className="text-muted-foreground text-xs">已经到底了</span>
                ) : shouldWaitForManualLoad ? (
                    <Button
                        variant="outline"
                        isLoading={isLoadingMore}
                        onClick={() => {
                            onLoadMore()
                        }}
                    >
                        加载更多
                    </Button>
                ) : isLoadingMore ? (
                    <span className="text-muted-foreground text-xs">正在加载更多...</span>
                ) : null}
            </div>
        </>
    )
}
