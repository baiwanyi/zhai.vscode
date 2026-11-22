/**
 * 单条评论的点赞（一级评论与子评论共用）：乐观更新点赞态与计数，失败回滚并提示，连点直接丢弃。
 * 复用约定：协议方法名取 @shared/types/weiboMethods，错误提示取 @shared/utils/error；
 * 状态初值来自调用方给的评论快照，宿主回包没带计数时沿用本地增减。
 * 关键约束：请求进行中用 ref 拦截，避免同一帧连点放大成多次写；
 * 不回写列表数据源，刷新评论列表后以服务端为准；评论行被重建时状态随之重置。
 */
import { useCallback, useRef, useState } from 'react'
import type { WeiboCommentLikeResult } from '@shared/types/weibo'
import { WEIBO_METHODS } from '@shared/types/weiboMethods'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
import { useIsMounted } from '@webview/hooks/useIsMounted'

/** 评论点赞超时：写操作不宜拖太久，失败让用户立刻重试 */
const LIKE_TIMEOUT_MS = 20_000

/** 点赞所需的评论快照：一级评论与子评论都满足该形状，评论 id 即 object_id */
export interface WeiboCommentLikeSource {
    id: string
    likes: number
    isLiked: boolean
}

export interface WeiboCommentLikeController {
    isLiked: boolean
    count: number
    isPending: boolean
    toggle: () => void
}

export function useWeiboCommentLike(comment: WeiboCommentLikeSource): WeiboCommentLikeController {
    const [isLiked, setIsLiked] = useState(comment.isLiked)
    const [count, setCount] = useState(comment.likes)
    const [isPending, setIsPending] = useState(false)
    const isPendingRef = useRef(false)
    /** 卸载标记：评论行随列表刷新重建，回包与失败提示不该落在已经换人的行上 */
    const isMountedRef = useIsMounted()

    const toggle = useCallback((): void => {
        if (isPendingRef.current) {
            return
        }
        isPendingRef.current = true
        setIsPending(true)
        const willLike = !isLiked
        setIsLiked(willLike)
        setCount((previous) => Math.max(0, previous + (willLike ? 1 : -1)))
        void request<WeiboCommentLikeResult>(
            WEIBO_METHODS.commentLike,
            { cid: comment.id, liked: willLike },
            LIKE_TIMEOUT_MS,
        )
            .then((result) => {
                if (!isMountedRef.current) {
                    return
                }
                setIsLiked(result.liked)
                if (result.likeCount !== null) {
                    setCount(result.likeCount)
                }
            })
            .catch((cause: unknown) => {
                if (!isMountedRef.current) {
                    return
                }
                // 回滚到点击前的状态，避免界面与服务端不一致
                setIsLiked(!willLike)
                setCount((previous) => Math.max(0, previous + (willLike ? -1 : 1)))
                toastError(cause)
            })
            .finally(() => {
                isPendingRef.current = false
                if (isMountedRef.current) {
                    setIsPending(false)
                }
            })
    }, [comment.id, isLiked, isMountedRef])

    return { isLiked, count, isPending, toggle }
}
