/**
 * 关注 / 取消关注：卡片头部「关注」按钮与「更多」菜单共用一套写操作状态。
 * 复用约定：协议走 weibo/author/follow，成功回执走 sonner，失败提示交 @shared/utils/error；
 * 状态以请求的目标状态为准（上游回包的 following 不可信），作者 uid 缺失时不给入口。
 * 关键约束：同一博主的连续点击用 ref 串行化；卸载后不再回写状态、不再弹提示。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { WeiboFollowResult } from '@shared/types/weibo'
import { WEIBO_METHODS } from '@shared/types/weiboMethods'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'

/** 关注写入超时：写操作比取数更短，失败让用户立刻重试 */
const FOLLOW_TIMEOUT_MS = 15_000

/** 关注目标：只取写操作与回执需要的三个字段 */
export interface WeiboAuthorFollowTarget {
    id: string
    name: string
    isFollowing: boolean
}

export interface WeiboAuthorFollowController {
    /** 当前关注态：初值取自上游，写操作后以请求的目标状态为准 */
    isFollowing: boolean
    /** 请求进行中：按钮转圈并禁用 */
    isFollowPending: boolean
    /** 作者 uid 缺失时没有可提交的目标，此时不给关注入口 */
    canFollow: boolean
    /** 关注 / 取关：true 关注，false 取消关注 */
    toggleFollow: (next: boolean) => void
}

export function useWeiboAuthorFollow(author: WeiboAuthorFollowTarget): WeiboAuthorFollowController {
    const { id, name } = author
    const [isFollowing, setIsFollowing] = useState(author.isFollowing)
    const [isFollowPending, setIsFollowPending] = useState(false)
    /** 请求占位：ref 判定，避免连点或闭包读到旧 state 把同一动作重复提交 */
    const isFollowPendingRef = useRef(false)
    /** 卸载标记：列表刷新会整块替换卡片，回包到货时组件可能已卸载，不再写状态、不再弹提示 */
    const isMountedRef = useRef(true)

    useEffect(() => {
        // StrictMode 会先卸载再挂载：每次进入都重置标记，否则回包会被误判为已卸载
        isMountedRef.current = true
        return (): void => {
            isMountedRef.current = false
        }
    }, [])

    const toggleFollow = useCallback(
        (next: boolean): void => {
            if (isFollowPendingRef.current || id.length === 0) {
                return
            }
            isFollowPendingRef.current = true
            setIsFollowPending(true)
            void request<WeiboFollowResult>(WEIBO_METHODS.authorFollow, { uid: id, following: next }, FOLLOW_TIMEOUT_MS)
                .then((result) => {
                    if (!isMountedRef.current) {
                        return
                    }
                    setIsFollowing(result.following)
                    // 关注与取关各给一条回执：按钮与菜单项都随状态切换，提示让人确认这次写操作已落库
                    if (result.following) {
                        toast.success(name.length > 0 ? `已关注 ${name}` : '已关注该博主')
                    } else {
                        toast.success('已取消关注')
                    }
                })
                .catch((cause: unknown) => {
                    if (isMountedRef.current) {
                        toastError(cause)
                    }
                })
                .finally(() => {
                    isFollowPendingRef.current = false
                    if (isMountedRef.current) {
                        setIsFollowPending(false)
                    }
                })
        },
        [id, name],
    )

    return { isFollowing, isFollowPending, canFollow: id.length > 0, toggleFollow }
}
