/**
 * 评论线程取数：首屏、续载与子评论展开，含游标、失败态与并发代际控制。
 * 复用约定：协议方法名取 @shared/types/weiboMethods，分页去重取 @shared/utils/mergeById，
 * 滚到底自动续载取 @webview/hooks/useScrollSentinel；本 Hook 只回状态与动作，不碰渲染。
 * 关键约束：续载与展开一律按 listVersion 代际丢弃过期回包——重拉会整块替换列表；
 * 首屏在途时不允许续载，否则会拿旧 maxId 把上一页追加到新列表尾部；
 * 续载失败保留已加载内容与游标，重试从当前位置继续；重拉成功会清空已展开的子评论。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
    WeiboCommentItem,
    WeiboCommentRepliesResult,
    WeiboCommentReply,
    WeiboCommentsResult,
} from '@shared/types/weibo'
import { WEIBO_METHODS } from '@shared/types/weiboMethods'
import { request } from '@shared/utils/bridge'
import { toastError, toErrorText } from '@shared/utils/error'
import { mergeById } from '@shared/utils/mergeById'
import { useScrollSentinel } from '@webview/hooks/useScrollSentinel'
import type { RefObject } from 'react'

/** 单页条数：与网页端一致 */
const PAGE_SIZE = 10

/** 子评论单页条数：网页端展开回复时按 20 条拉，一次尽量看全 */
const REPLY_PAGE_SIZE = 20

/** 评论请求超时：评论区展开是用户主动等待的场景，放宽一点 */
const REQUEST_TIMEOUT_MS = 20_000

/** 某条一级评论已展开的回复：maxId 为 null 表示上游没有更多 */
export interface ExpandedReplies {
    replies: WeiboCommentReply[]
    maxId: string | null
}

export interface WeiboCommentThread {
    comments: WeiboCommentItem[]
    /** 上游声明的评论总数：首屏才更新，续载不动它 */
    total: number | null
    hasMore: boolean
    /** 能否续载：首屏重拉失败时先整块重试，不允许绕过它继续追加旧页 */
    canLoadMore: boolean
    isLoading: boolean
    isLoadingMore: boolean
    /** 首屏失败：列表为空，重试即整块重拉 */
    error: string | null
    /** 续载失败：已加载内容与游标都保留，重试从当前 maxId 继续 */
    loadMoreError: string | null
    /** 已展开的回复：key 是一级评论 id，展开后覆盖该评论随列表下发的预览 */
    expandedReplies: Record<string, ExpandedReplies>
    /** 正在拉取回复的评论 id：按钮据此显示加载中文案 */
    expandingIds: string[]
    sentinelRef: RefObject<HTMLDivElement | null>
    reload: () => Promise<void>
    loadMore: () => Promise<void>
    loadReplies: (comment: WeiboCommentItem, loaded: ExpandedReplies | undefined) => Promise<void>
}

export function useWeiboCommentThread(postId: string): WeiboCommentThread {
    const [comments, setComments] = useState<WeiboCommentItem[]>([])
    const [maxId, setMaxId] = useState<string | null>(null)
    const [hasMore, setHasMore] = useState(false)
    const [total, setTotal] = useState<number | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [isLoadingMore, setIsLoadingMore] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [loadMoreError, setLoadMoreError] = useState<string | null>(null)
    const [expandedReplies, setExpandedReplies] = useState<Record<string, ExpandedReplies>>({})
    const [expandingIds, setExpandingIds] = useState<string[]>([])
    /** 续载在途标记：state 更新是异步的，同一帧内哨兵与按钮两个入口都会读到旧值而重复发请求 */
    const isLoadingMoreRef = useRef(false)
    /** 首屏在途标记：重拉期间不允许续载，否则会拿旧游标把上一页数据追加到新列表尾部 */
    const isLoadingFirstRef = useRef(false)
    /** 列表代际：每次重拉递增，回包序号过期的一律丢弃，避免在途续载覆盖或污染新列表 */
    const listVersionRef = useRef(0)
    const expandingIdsRef = useRef<Set<string>>(new Set())

    const loadFirstPage = useCallback(async (): Promise<void> => {
        const version = listVersionRef.current + 1
        listVersionRef.current = version
        isLoadingFirstRef.current = true
        setIsLoading(true)
        setError(null)
        setLoadMoreError(null)
        try {
            const result = await request<WeiboCommentsResult>(
                WEIBO_METHODS.comments,
                { id: postId, count: PAGE_SIZE },
                REQUEST_TIMEOUT_MS,
            )
            // 期间又发起过重拉：本次结果已过时，交给最新那一次落地，这里不写任何状态
            if (version !== listVersionRef.current) {
                return
            }
            setComments(result.comments)
            // 列表整体替换后子评论预览可能已变，旧的展开结果一律作废，避免展示过期回复
            setExpandedReplies({})
            setMaxId(result.maxId)
            setHasMore(result.hasMore)
            setTotal(result.totalNumber)
        } catch (cause) {
            if (version !== listVersionRef.current) {
                return
            }
            setError(toErrorText(cause))
        } finally {
            // 只有最新一次重拉才有资格收尾，过时的请求不能把在途标记提前清掉
            if (version === listVersionRef.current) {
                isLoadingFirstRef.current = false
                setIsLoading(false)
            }
        }
    }, [postId])

    /** 续载下一批：maxId 只在成功时前进，失败保留当前游标，重试即从当前位置继续 */
    const loadMore = useCallback(async (): Promise<void> => {
        if (maxId === null || isLoadingMoreRef.current || isLoadingFirstRef.current) {
            return
        }
        const version = listVersionRef.current
        isLoadingMoreRef.current = true
        setIsLoadingMore(true)
        setLoadMoreError(null)
        try {
            const result = await request<WeiboCommentsResult>(
                WEIBO_METHODS.comments,
                { id: postId, maxId, count: PAGE_SIZE },
                REQUEST_TIMEOUT_MS,
            )
            // 期间列表已整块重拉：游标来自旧列表，结果直接丢弃
            if (version !== listVersionRef.current) {
                return
            }
            setComments((previous) => mergeById(previous, result.comments))
            setMaxId(result.maxId)
            setHasMore(result.hasMore)
        } catch (cause) {
            if (version !== listVersionRef.current) {
                return
            }
            setLoadMoreError(toErrorText(cause))
        } finally {
            isLoadingMoreRef.current = false
            setIsLoadingMore(false)
        }
    }, [maxId, postId])

    const canLoadMore = hasMore && error === null

    useEffect(() => {
        void loadFirstPage()
    }, [loadFirstPage])

    /** 续载哨兵：滚动到底部即自动拉下一批；条目数作观察信号，首屏没填满时可继续补载 */
    const sentinelRef = useScrollSentinel({
        hasMore: canLoadMore && loadMoreError === null,
        onLoadMore: loadMore,
        observeKey: comments.length,
    })

    /**
     * 展开更多回复：把该评论下的子评论翻页拉回来，与已有预览按 id 去重拼接。
     * 关键约束：同一评论同时只允许一条在飞（ref 判定），游标从已加载状态里取，取完仍可继续。
     */
    const loadReplies = useCallback(
        async (comment: WeiboCommentItem, loaded: ExpandedReplies | undefined): Promise<void> => {
            if (expandingIdsRef.current.has(comment.id)) {
                return
            }
            const version = listVersionRef.current
            expandingIdsRef.current.add(comment.id)
            setExpandingIds((previous) => [...previous, comment.id])
            try {
                const result = await request<WeiboCommentRepliesResult>(
                    WEIBO_METHODS.commentReplies,
                    loaded === undefined
                        ? { id: comment.id, count: REPLY_PAGE_SIZE }
                        : { id: comment.id, maxId: loaded.maxId, count: REPLY_PAGE_SIZE },
                    REQUEST_TIMEOUT_MS,
                )
                // 列表已整块重拉：展开态刚被清空，这份回包对应的评论可能已不存在，直接丢弃
                if (version !== listVersionRef.current) {
                    return
                }
                setExpandedReplies((previous) => ({
                    ...previous,
                    [comment.id]: {
                        replies: mergeById(loaded?.replies ?? comment.replies, result.replies),
                        maxId: result.maxId,
                    },
                }))
            } catch (cause) {
                if (version !== listVersionRef.current) {
                    return
                }
                toastError(cause)
            } finally {
                expandingIdsRef.current.delete(comment.id)
                setExpandingIds((previous) => previous.filter((id) => id !== comment.id))
            }
        },
        [],
    )

    return {
        comments,
        total,
        hasMore,
        canLoadMore,
        isLoading,
        isLoadingMore,
        error,
        loadMoreError,
        expandedReplies,
        expandingIds,
        sentinelRef,
        reload: loadFirstPage,
        loadMore,
        loadReplies,
    }
}
