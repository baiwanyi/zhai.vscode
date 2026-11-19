/**
 * 评论区：展开时才请求第一页，支持继续加载。
 * 复用约定：weibo/comments 协议；正文与表情复用 WeiboRichText，头像复用 WeiboAvatar；
 * 错误内联展示并给重试，不弹 toast——展开评论是浏览动作，失败不该打断整页。
 * 关键约束：父级条件渲染保证每次展开都是新实例，进入即拉第一页；
 * 分页按 maxId 串行请求，同时只允许一个在途请求；到底后不再渲染「加载更多」。
 */
import { format } from 'date-fns'
import { useCallback, useEffect, useState } from 'react'
import { Spinner } from '@components/ui/spinner'
import type { WeiboCommentItem, WeiboCommentsResult } from '@shared/types/weibo'
import { request } from '@shared/utils/bridge'
import { toErrorText } from '@shared/utils/error'
import { Button } from '@webview/components/Button'
import { WeiboAvatar } from './WeiboAvatar'
import { WeiboRichText } from './WeiboRichText'
import type { JSX } from 'react'

/** 单页条数：与网页端一致 */
const PAGE_SIZE = 10

/** 评论请求超时：评论区展开是用户主动等待的场景，放宽一点 */
const REQUEST_TIMEOUT_MS = 20_000

/** 评论时间：同一年省掉年份，解析失败回退上游原串 */
function formatCommentTime(comment: WeiboCommentItem): string {
    if (comment.createdAt.length === 0) {
        return comment.createdAtRaw
    }
    const date = new Date(comment.createdAt)
    if (Number.isNaN(date.getTime())) {
        return comment.createdAtRaw
    }
    const isSameYear = date.getFullYear() === new Date().getFullYear()
    return format(date, isSameYear ? 'MM-dd HH:mm' : 'yyyy-MM-dd HH:mm')
}

/** 合并分页结果：按评论 id 去重，保持服务端顺序 */
function mergeComments(current: WeiboCommentItem[], incoming: WeiboCommentItem[]): WeiboCommentItem[] {
    const seen = new Set(current.map((comment) => comment.id))
    const merged = [...current]
    for (const comment of incoming) {
        if (seen.has(comment.id)) {
            continue
        }
        seen.add(comment.id)
        merged.push(comment)
    }
    return merged
}

interface WeiboCommentListProps {
    /** 微博数字 id */
    postId: string
    /** 时间线给出的评论总数：接口未回传时用它兜底展示 */
    totalCount: number
}

export function WeiboCommentList({ postId, totalCount }: WeiboCommentListProps): JSX.Element {
    const [comments, setComments] = useState<WeiboCommentItem[]>([])
    const [maxId, setMaxId] = useState<string | null>(null)
    const [hasMore, setHasMore] = useState(false)
    const [total, setTotal] = useState<number | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [isLoadingMore, setIsLoadingMore] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const loadFirstPage = useCallback(async (): Promise<void> => {
        setIsLoading(true)
        setError(null)
        try {
            const result = await request<WeiboCommentsResult>(
                'weibo/comments',
                { id: postId, count: PAGE_SIZE },
                REQUEST_TIMEOUT_MS,
            )
            setComments(result.comments)
            setMaxId(result.maxId)
            setHasMore(result.hasMore)
            setTotal(result.totalNumber)
        } catch (cause) {
            setError(toErrorText(cause))
        } finally {
            setIsLoading(false)
        }
    }, [postId])

    const loadMore = useCallback(async (): Promise<void> => {
        if (maxId === null || isLoadingMore) {
            return
        }
        setIsLoadingMore(true)
        setError(null)
        try {
            const result = await request<WeiboCommentsResult>(
                'weibo/comments',
                { id: postId, maxId, count: PAGE_SIZE },
                REQUEST_TIMEOUT_MS,
            )
            setComments((previous) => mergeComments(previous, result.comments))
            setMaxId(result.maxId)
            setHasMore(result.hasMore)
        } catch (cause) {
            setError(toErrorText(cause))
        } finally {
            setIsLoadingMore(false)
        }
    }, [isLoadingMore, maxId, postId])

    useEffect(() => {
        void loadFirstPage()
    }, [loadFirstPage])

    const shownTotal = total ?? totalCount

    return (
        <section className="flex flex-col gap-1 rounded-lg bg-muted/40 px-3 py-2">
            <p className="text-muted-foreground text-xs">共 {shownTotal} 条评论</p>
            {isLoading ? (
                <div className="flex justify-center py-3">
                    <Spinner className="size-4" />
                </div>
            ) : null}
            {comments.map((comment) => (
                <article key={comment.id} className="flex gap-2 border-b border-border/40 py-2 last:border-b-0">
                    <WeiboAvatar
                        name={comment.author.name}
                        avatarUrl={comment.author.avatarUrl}
                        className="size-7 text-xs"
                    />
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                            <span className="text-xs font-medium">
                                {comment.author.name.length > 0 ? comment.author.name : '匿名'}
                            </span>
                            <span className="text-muted-foreground text-[11px]">{formatCommentTime(comment)}</span>
                        </div>
                        <p className="mt-0.5 whitespace-pre-wrap wrap-break-word text-xs leading-relaxed">
                            <WeiboRichText segments={comment.segments} />
                        </p>
                    </div>
                    {comment.likes > 0 ? (
                        <span className="shrink-0 text-muted-foreground text-[11px]">{comment.likes}</span>
                    ) : null}
                </article>
            ))}
            {!isLoading && comments.length === 0 && error === null ? (
                <p className="py-1 text-muted-foreground text-xs">还没有评论</p>
            ) : null}
            {error !== null ? <p className="py-1 text-destructive text-xs">{error}</p> : null}
            <div className="flex items-center gap-2 pt-1">
                {hasMore ? (
                    <Button size="xs" variant="ghost" onClick={() => void loadMore()} isLoading={isLoadingMore}>
                        加载更多评论
                    </Button>
                ) : null}
                {error !== null && !isLoading ? (
                    <Button size="xs" variant="outline" onClick={() => void loadFirstPage()}>
                        重试
                    </Button>
                ) : null}
            </div>
        </section>
    )
}
