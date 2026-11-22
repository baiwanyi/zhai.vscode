/**
 * 卡片点赞按钮：乐观更新点赞态与计数，失败回滚并提示；外观复用 WeiboMetricButton（品红）。
 * 复用约定：协议走 weibo/like，转圈、禁用与串行化由本组件持有，底栏三等分与配色交给 WeiboMetricButton。
 * 关键约束：写操作不能被连点放大——请求进行中直接丢弃点击（ref 判定，避免闭包读到旧 state）；
 * 卸载后不再回写状态、不再弹提示；上游未回传计数时保留本地乐观值。
 */
import { Heart } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { WeiboLikeResult } from '@shared/types/weibo'
import { WEIBO_METHODS } from '@shared/types/weiboMethods'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
import { WeiboMetricButton } from './WeiboMetricButton'
import type { JSX } from 'react'

/** 点赞请求超时：与宿主侧 20s 口径一致 */
const LIKE_TIMEOUT_MS = 20_000

export interface WeiboPostLikeButtonProps {
    /** 微博数字 id：点赞接口的入参 */
    postId: string
    initialLiked: boolean
    initialCount: number
    /** 排布微调：底栏三等分时由调用方补 flex-1 与居中 */
    className?: string
}

export function WeiboPostLikeButton({
    postId,
    initialLiked,
    initialCount,
    className,
}: WeiboPostLikeButtonProps): JSX.Element {
    const [isLiked, setIsLiked] = useState(initialLiked)
    const [count, setCount] = useState(initialCount)
    const [isPending, setIsPending] = useState(false)
    const isPendingRef = useRef(false)
    /** 卸载标记：列表刷新会整块替换卡片，回包到货时组件可能已卸载，不再写状态、不再弹提示 */
    const isMountedRef = useRef(true)

    useEffect(() => {
        // StrictMode 会先卸载再挂载：每次进入都重置标记，否则回包会被误判为已卸载
        isMountedRef.current = true
        return (): void => {
            isMountedRef.current = false
        }
    }, [])

    const handleClick = useCallback((): void => {
        if (isPendingRef.current) {
            return
        }
        isPendingRef.current = true
        setIsPending(true)
        const willLike = !isLiked
        setIsLiked(willLike)
        setCount((previous) => Math.max(0, previous + (willLike ? 1 : -1)))
        void request<WeiboLikeResult>(WEIBO_METHODS.like, { id: postId, liked: willLike }, LIKE_TIMEOUT_MS)
            .then((result) => {
                if (!isMountedRef.current) {
                    return
                }
                setIsLiked(result.liked)
                if (result.attitudesCount !== null) {
                    setCount(result.attitudesCount)
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
    }, [isLiked, postId])

    return (
        <WeiboMetricButton
            icon={<Heart className="size-4" fill={isLiked ? 'currentColor' : 'none'} aria-hidden="true" />}
            count={count}
            ariaLabel={isLiked ? '取消赞' : '赞'}
            isActive={isLiked}
            tone="pink"
            ariaPressed={isLiked}
            disabled={isPending}
            onClick={handleClick}
            className={className}
        />
    )
}
