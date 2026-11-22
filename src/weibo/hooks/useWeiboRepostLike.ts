/**
 * 单条转发的点赞：乐观更新点赞态与计数，失败回滚并提示，同一条转发的连点直接丢弃。
 * 复用约定：协议方法名取 @shared/types/weiboMethods（weibo/repost/like），错误提示取 @shared/utils/error；
 * 与评论点赞同一套乐观更新，差别只在协议：转发走 setLike / cancelLike 的 form 口径。
 * 关键约束：请求进行中用 ref 拦截，避免同一帧连点放大成多次写；
 * 不回写列表数据源，刷新转发列表后以服务端为准；条目被重建时状态随之重置。
 */
import { useCallback, useRef, useState } from 'react'
import type { WeiboLikeResult, WeiboRepostItem } from '@shared/types/weibo'
import { WEIBO_METHODS } from '@shared/types/weiboMethods'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'

/** 转发点赞超时：写操作不宜拖太久，失败让用户立刻重试 */
const LIKE_TIMEOUT_MS = 20_000

export interface WeiboRepostLikeController {
    isLiked: boolean
    /** 点赞数：null 表示上游没下发该字段，界面不显示数字（与真实的 0 区分） */
    count: number | null
    isPending: boolean
    toggle: () => void
}

export function useWeiboRepostLike(repost: WeiboRepostItem): WeiboRepostLikeController {
    const [isLiked, setIsLiked] = useState(repost.isLiked)
    const [count, setCount] = useState<number | null>(repost.likes)
    const [isPending, setIsPending] = useState(false)
    const isPendingRef = useRef(false)

    const toggle = useCallback((): void => {
        if (isPendingRef.current) {
            return
        }
        isPendingRef.current = true
        setIsPending(true)
        const willLike = !isLiked
        setIsLiked(willLike)
        // 上游没给计数时按 0 起算：用户点了赞，界面至少应看到 1
        setCount((previous) => Math.max(0, (previous ?? 0) + (willLike ? 1 : -1)))
        void request<WeiboLikeResult>(WEIBO_METHODS.repostLike, { id: repost.id, liked: willLike }, LIKE_TIMEOUT_MS)
            .then((result) => {
                setIsLiked(result.liked)
                if (result.attitudesCount !== null) {
                    // 点赞取服务端与乐观值的较大者：回包偶尔是旧快照，直接回落会把刚出现的 1 抹掉；
                    // 取消赞则完全以服务端为准，避免把本地虚高的数字留住
                    setCount((previous) =>
                        willLike ? Math.max(result.attitudesCount ?? 0, previous ?? 0) : result.attitudesCount,
                    )
                }
            })
            .catch((cause: unknown) => {
                // 回滚到点击前的状态，避免界面与服务端不一致
                setIsLiked(!willLike)
                setCount((previous) => (previous === null ? null : Math.max(0, previous + (willLike ? -1 : 1))))
                toastError(cause)
            })
            .finally(() => {
                isPendingRef.current = false
                setIsPending(false)
            })
    }, [repost.id, isLiked])

    return { isLiked, count, isPending, toggle }
}
