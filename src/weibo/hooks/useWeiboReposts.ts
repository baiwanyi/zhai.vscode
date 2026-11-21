/**
 * 转发列表取数：首屏、按页码续载与本地总数增减，含代际与在途并发控制。
 * 复用约定：协议方法名取 @shared/types/weiboMethods，分页去重取 @shared/utils/mergeById，
 * 滚到底自动续载取 @webview/hooks/useScrollSentinel；本 Hook 只回状态与动作，不碰渲染。
 * 关键约束：重拉会整块替换列表，在途续载回包按代际丢弃——页码游标一旦跳页就会缺内容；
 * 首屏在途时不允许续载；续载失败保留已加载内容与页码，重试从当前位置继续；
 * 总数用本地偏移兜住删除 / 发布，父级 totalCount 变化即丢弃旧偏移。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { WeiboRepostItem, WeiboRepostsResult } from '@shared/types/weibo'
import { WEIBO_METHODS } from '@shared/types/weiboMethods'
import { request } from '@shared/utils/bridge'
import { toErrorText } from '@shared/utils/error'
import { mergeById } from '@shared/utils/mergeById'
import { useScrollSentinel } from '@webview/hooks/useScrollSentinel'
import type { RefObject } from 'react'

/** 单页条数：与网页端转发列表一致 */
const PAGE_SIZE = 10

/** 请求超时：展开列表与提交转发都是主动等待的场景，与评论同口径 */
const REQUEST_TIMEOUT_MS = 20_000

export interface WeiboReposts {
    reposts: WeiboRepostItem[]
    hasMore: boolean
    /** 能否续载：首屏重拉失败时先整块重试，不允许绕过它继续追加旧页 */
    canLoadMore: boolean
    isLoading: boolean
    isLoadingMore: boolean
    /** 首屏失败：列表还是空的，重试即整块重拉 */
    error: string | null
    /** 续载失败：已加载内容与页码都保留，重试从当前页继续 */
    loadMoreError: string | null
    /** 展示用总数：父级快照加上本地增减 */
    shownTotal: number
    /** 写操作成功后的总数变化：发布 +1、删除 -1 */
    adjustCount: (delta: 1 | -1) => void
    sentinelRef: RefObject<HTMLDivElement | null>
    reload: () => Promise<void>
    loadMore: () => Promise<void>
}

export function useWeiboReposts(postId: string, totalCount: number): WeiboReposts {
    const [reposts, setReposts] = useState<WeiboRepostItem[]>([])
    const [page, setPage] = useState(1)
    const [hasMore, setHasMore] = useState(false)
    const [isLoading, setIsLoading] = useState(true)
    const [isLoadingMore, setIsLoadingMore] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [loadMoreError, setLoadMoreError] = useState<string | null>(null)
    /** 续载在途标记：state 更新是异步的，同一帧内哨兵与按钮两个入口都会读到旧值而重复发请求 */
    const isLoadingMoreRef = useRef(false)
    /** 首屏在途标记：重拉期间不允许续载，否则会拿旧页码把后续页追加到新列表 */
    const isLoadingFirstRef = useRef(false)
    /** 列表代际：每次重拉递增，回包序号过期的一律丢弃，避免在途续载推进页码造成跳页 */
    const listVersionRef = useRef(0)

    /** 回包是否已过期：重拉之后才返回的在途请求一律不落地 */
    const isStale = useCallback((version: number): boolean => version !== listVersionRef.current, [])

    const loadFirstPage = useCallback(async (): Promise<void> => {
        const version = listVersionRef.current + 1
        listVersionRef.current = version
        isLoadingFirstRef.current = true
        setIsLoading(true)
        setError(null)
        setLoadMoreError(null)
        try {
            const result = await request<WeiboRepostsResult>(
                WEIBO_METHODS.reposts,
                { id: postId, page: 1, count: PAGE_SIZE },
                REQUEST_TIMEOUT_MS,
            )
            // 期间又发起过重拉：本次结果已过时，交给最新那一次落地，这里不写任何状态
            if (isStale(version)) {
                return
            }
            setReposts(result.reposts)
            setPage(result.page)
            setHasMore(result.hasMore)
        } catch (cause) {
            if (isStale(version)) {
                return
            }
            setError(toErrorText(cause))
        } finally {
            // 只有最新一次重拉才有资格收尾，过时的请求不能把在途标记提前清掉
            if (!isStale(version)) {
                isLoadingFirstRef.current = false
                setIsLoading(false)
            }
        }
    }, [isStale, postId])

    /** 续载下一页：页码只在成功时前进，失败保留当前页，重试即从当前位置继续 */
    const loadMore = useCallback(async (): Promise<void> => {
        if (!hasMore || isLoadingMoreRef.current || isLoadingFirstRef.current) {
            return
        }
        const version = listVersionRef.current
        isLoadingMoreRef.current = true
        setIsLoadingMore(true)
        setLoadMoreError(null)
        try {
            const result = await request<WeiboRepostsResult>(
                WEIBO_METHODS.reposts,
                { id: postId, page: page + 1, count: PAGE_SIZE },
                REQUEST_TIMEOUT_MS,
            )
            // 期间列表已整块重拉：页码已回到第一页，这份回包会把页码推成跳页，直接丢弃
            if (isStale(version)) {
                return
            }
            setReposts((previous) => mergeById(previous, result.reposts))
            setPage(result.page)
            setHasMore(result.hasMore)
        } catch (cause) {
            if (isStale(version)) {
                return
            }
            setLoadMoreError(toErrorText(cause))
        } finally {
            isLoadingMoreRef.current = false
            setIsLoadingMore(false)
        }
    }, [hasMore, isStale, page, postId])

    useEffect(() => {
        void loadFirstPage()
    }, [loadFirstPage])

    const canLoadMore = hasMore && error === null

    /** 续载哨兵：滚动到底部即自动拉下一页；条目数作观察信号，首屏没填满时可继续补载 */
    const sentinelRef = useScrollSentinel({
        hasMore: canLoadMore && loadMoreError === null,
        onLoadMore: loadMore,
        observeKey: reposts.length,
    })

    /**
     * 总数本地增减：删除 / 发布都只重拉列表，父级 totalCount 快照不会跟着变，故用本地偏移兜住；
     * 父级总数一旦变化（时间线刷新）就丢弃旧偏移，避免把上一轮差值算到新数据上。
     */
    const [countState, setCountState] = useState({ base: totalCount, offset: 0 })
    const countOffset = countState.base === totalCount ? countState.offset : 0
    const shownTotal = Math.max(0, totalCount + countOffset)

    const adjustCount = useCallback(
        (delta: 1 | -1): void => {
            setCountState((previous) => ({
                base: previous.base === totalCount ? previous.base : totalCount,
                offset: (previous.base === totalCount ? previous.offset : 0) + delta,
            }))
        },
        [totalCount],
    )

    return {
        reposts,
        hasMore,
        canLoadMore,
        isLoading,
        isLoadingMore,
        error,
        loadMoreError,
        shownTotal,
        adjustCount,
        sentinelRef,
        reload: loadFirstPage,
        loadMore,
    }
}
