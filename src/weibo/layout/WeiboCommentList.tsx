/**
 * 评论区：展开时先拉第一页评论，支持继续加载，并在列表上方提供发布 / 回复框。
 * 复用约定：weibo/comments 读取、weibo/comment/create 发布与回复、weibo/comment/destroy 删除；
 * 正文与表情复用 WeiboRichText，头像复用 WeiboAvatar，删除确认复用 shadcn 的 AlertDialog；
 * 发布框用 shadcn 的 Textarea，字数上限与网页端评论框一致（WEIBO_COMMENT_MAX_LENGTH）。
 * 关键约束：父级条件渲染保证每次展开都是新实例，进入即拉第一页；
 * 分页按 maxId 串行请求，同时只允许一个在途请求；到底后不再渲染「加载更多」；
 * 列表限高滚动，发布框与「加载更多」固定在滚动区之外，不随评论滚走；
 * 一级评论下的子评论（上游随列表下发的预览）缩进成一组渲染，被回复者用「回复 @某人」标出；
 * 预览不足时给「展开 N 条回复」，走 weibo/comment/replies（同端点 + is_mix=1 / fetch_level=1）
 * 按 maxId 续翻并与已有预览去重拼接，同一评论同时只允许一条在飞；
 * 回复复用同一个发布框（点「回复」回填被回复对象，提交时带 replyToId），不再另开一个输入框；
 * 发布框的「同时转发」开关打开时改走 weibo/repost 的评论并转发，评论由上游一并生成（回复态不提供）；
 * 删除入口只给自己的评论：viewerUid 与评论作者 id 相同才渲染，最终归属仍由上游判定；
 * 发布 / 回复 / 删除都是主动提交，失败弹 toast，而读取失败仍内联提示不打断浏览。
 */
import { format } from 'date-fns'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@components/ui/alert-dialog'
import { Spinner } from '@components/ui/spinner'
import { Textarea } from '@components/ui/textarea'
import { WEIBO_COMMENT_MAX_LENGTH } from '@shared/types/weibo'
import type {
    WeiboCommentCreateResult,
    WeiboCommentDestroyResult,
    WeiboCommentItem,
    WeiboCommentRepliesResult,
    WeiboCommentReply,
    WeiboCommentsResult,
    WeiboRepostCreateResult,
} from '@shared/types/weibo'
import { request } from '@shared/utils/bridge'
import { toastError, toErrorText } from '@shared/utils/error'
import { Button } from '@webview/components/Button'
import { Switch } from '@webview/components/Switch'
import { WeiboAvatar } from './WeiboAvatar'
import { WeiboRichText } from './WeiboRichText'
import type { JSX, KeyboardEvent } from 'react'

/** 单页条数：与网页端一致 */
const PAGE_SIZE = 10

/** 子评论单页条数：网页端展开回复时按 20 条拉，一次尽量看全 */
const REPLY_PAGE_SIZE = 20

/** 评论请求超时：评论区展开是用户主动等待的场景，放宽一点 */
const REQUEST_TIMEOUT_MS = 20_000

/** 评论写操作超时：发布、回复与删除都用同一口径，失败要尽快让用户重试 */
const MUTATE_TIMEOUT_MS = 20_000

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

/** 合并子评论：按 id 去重，保持服务端顺序——展开更多回复时要与已有预览拼接 */
function mergeReplies(current: WeiboCommentReply[], incoming: WeiboCommentReply[]): WeiboCommentReply[] {
    const seen = new Set(current.map((reply) => reply.id))
    const merged = [...current]
    for (const reply of incoming) {
        if (seen.has(reply.id)) {
            continue
        }
        seen.add(reply.id)
        merged.push(reply)
    }
    return merged
}

/** 某条一级评论已展开的回复：maxId 为 null 表示上游没有更多 */
interface ExpandedReplies {
    replies: WeiboCommentReply[]
    maxId: string | null
}

/** 回复目标：只用评论 id 与作者名，正文由同一个发布框提交 */
interface CommentReplyTarget {
    id: string
    authorName: string
}

interface WeiboCommentListProps {
    /** 微博数字 id */
    postId: string
    /** 时间线给出的评论总数：接口未回传时用它兜底展示 */
    totalCount: number
    /** 当前登录账号 uid：与评论作者 id 相同才显示删除入口 */
    viewerUid?: string | null
}

export function WeiboCommentList({ postId, totalCount, viewerUid = null }: WeiboCommentListProps): JSX.Element {
    const [comments, setComments] = useState<WeiboCommentItem[]>([])
    const [maxId, setMaxId] = useState<string | null>(null)
    const [hasMore, setHasMore] = useState(false)
    const [total, setTotal] = useState<number | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [isLoadingMore, setIsLoadingMore] = useState(false)
    const [error, setError] = useState<string | null>(null)
    /** 同时转发：评论的同时把这条微博转到自己主页，与回复互斥（回复不支持转发） */
    const [shouldRepost, setShouldRepost] = useState(false)
    /** 发布框草稿：发布或回复成功即清空 */
    const [draft, setDraft] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)
    /** 回复目标：非空时提交走回复端点，发布框上方回显被回复对象 */
    const [replyTarget, setReplyTarget] = useState<CommentReplyTarget | null>(null)
    /** 待删除评论：非空即打开确认框，同一时刻只处理一条 */
    const [pendingDelete, setPendingDelete] = useState<WeiboCommentItem | null>(null)
    const [isDestroying, setIsDestroying] = useState(false)
    /** 已展开的回复：key 是一级评论 id，展开后覆盖该评论随列表下发的预览 */
    const [expandedReplies, setExpandedReplies] = useState<Record<string, ExpandedReplies>>({})
    /** 正在拉取回复的评论 id：按钮据此显示加载中文案 */
    const [expandingIds, setExpandingIds] = useState<string[]>([])
    /** 写操作占位：ref 判定，避开同一帧连点读到旧 state */
    const isSubmittingRef = useRef(false)
    const isDestroyingRef = useRef(false)
    const expandingIdsRef = useRef<Set<string>>(new Set())

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

    /**
     * 展开更多回复：把该评论下的子评论翻页拉回来，与已有预览按 id 去重拼接。
     * 关键约束：同一评论同时只允许一条在飞（ref 判定），游标从已加载状态里取，取完仍可继续。
     */
    const loadReplies = useCallback(
        async (comment: WeiboCommentItem, loaded: ExpandedReplies | undefined): Promise<void> => {
            if (expandingIdsRef.current.has(comment.id)) {
                return
            }
            expandingIdsRef.current.add(comment.id)
            setExpandingIds((previous) => [...previous, comment.id])
            try {
                const result = await request<WeiboCommentRepliesResult>(
                    'weibo/comment/replies',
                    loaded === undefined
                        ? { id: comment.id, count: REPLY_PAGE_SIZE }
                        : { id: comment.id, maxId: loaded.maxId, count: REPLY_PAGE_SIZE },
                    REQUEST_TIMEOUT_MS,
                )
                setExpandedReplies((previous) => ({
                    ...previous,
                    [comment.id]: {
                        replies: mergeReplies(loaded?.replies ?? comment.replies, result.replies),
                        maxId: result.maxId,
                    },
                }))
            } catch (cause) {
                toastError(cause)
            } finally {
                expandingIdsRef.current.delete(comment.id)
                setExpandingIds((previous) => previous.filter((id) => id !== comment.id))
            }
        },
        [],
    )

    const trimmedDraft = draft.trim()
    const isDraftValid = trimmedDraft.length > 0 && trimmedDraft.length <= WEIBO_COMMENT_MAX_LENGTH

    /**
     * 发布或回复：成功后清空输入与回复目标并重拉第一页，写操作失败弹 toast 让用户重试。
     * 关键约束：「同时转发」是评论 + 转发两步，评论成功而转发失败按部分成功处理——
     * 清空草稿并关掉开关、照常刷新列表，避免用户再点一次把同一条评论发重。
     */
    const submitComment = useCallback(async (): Promise<void> => {
        if (isSubmittingRef.current || !isDraftValid) {
            return
        }
        isSubmittingRef.current = true
        setIsSubmitting(true)
        const target = replyTarget
        try {
            if (target === null && shouldRepost) {
                // 同时转发 = 先发评论再转发（宿主两步），回包用 commented / reposted 标记各自结果
                const result = await request<WeiboRepostCreateResult>(
                    'weibo/repost',
                    { id: postId, comment: trimmedDraft, mode: 'commentWithRepost' },
                    MUTATE_TIMEOUT_MS,
                )
                setDraft('')
                setReplyTarget(null)
                if (result.commented && !result.reposted) {
                    // 评论已发出、转发失败：关掉开关，避免再次两步提交把评论发重
                    setShouldRepost(false)
                    toast.warning(`评论已发布，但转发失败：${result.failureMessage ?? '未知原因'}`)
                } else {
                    toast.success('已评论并转发')
                }
                await loadFirstPage()
                return
            }

            await request<WeiboCommentCreateResult>(
                'weibo/comment/create',
                target === null
                    ? { id: postId, text: trimmedDraft }
                    : { id: postId, text: trimmedDraft, replyToId: target.id },
                MUTATE_TIMEOUT_MS,
            )
            setDraft('')
            setReplyTarget(null)
            toast.success(target === null ? '评论已发布' : `已回复 @${target.authorName}`)
            await loadFirstPage()
        } catch (cause) {
            toastError(cause)
        } finally {
            isSubmittingRef.current = false
            setIsSubmitting(false)
        }
    }, [isDraftValid, loadFirstPage, postId, replyTarget, shouldRepost, trimmedDraft])

    /** 删除自己的评论：只在确认框里触发，成功后重拉第一页并收起确认框 */
    const destroyComment = useCallback(async (): Promise<void> => {
        const target = pendingDelete
        if (target === null || isDestroyingRef.current) {
            return
        }
        isDestroyingRef.current = true
        setIsDestroying(true)
        try {
            await request<WeiboCommentDestroyResult>('weibo/comment/destroy', { cid: target.id }, MUTATE_TIMEOUT_MS)
            toast.success('评论已删除')
            setPendingDelete(null)
            // 回复目标正好被删掉时一并清空，避免继续对不存在的评论提交回复
            if (replyTarget?.id === target.id) {
                setReplyTarget(null)
            }
            await loadFirstPage()
        } catch (cause) {
            toastError(cause)
        } finally {
            isDestroyingRef.current = false
            setIsDestroying(false)
        }
    }, [loadFirstPage, pendingDelete, replyTarget])

    /** Ctrl / Cmd + Enter 直接发送：面板里敲评论不走表单回流 */
    const handleDraftKeyDown = useCallback(
        (event: KeyboardEvent<HTMLTextAreaElement>): void => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault()
                void submitComment()
            }
        },
        [submitComment],
    )

    const shownTotal = total ?? totalCount

    return (
        <section className="flex flex-col gap-2 rounded-lg bg-muted/40 px-3 py-2">
            <p className="text-muted-foreground text-xs">共 {shownTotal} 条评论</p>

            {/* 发布框固定在列表上方：回复态只在上方回显被回复对象，输入框仍是同一个 */}
            <div className="flex flex-col gap-1">
                {replyTarget === null ? null : (
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="truncate">回复 @{replyTarget.authorName}</span>
                        <button
                            type="button"
                            className="shrink-0 transition-colors hover:text-foreground"
                            onClick={() => {
                                setReplyTarget(null)
                            }}
                        >
                            取消
                        </button>
                    </div>
                )}
                <Textarea
                    value={draft}
                    onChange={(event) => {
                        setDraft(event.target.value)
                    }}
                    onKeyDown={handleDraftKeyDown}
                    placeholder={replyTarget === null ? '写评论…' : `回复 @${replyTarget.authorName}`}
                    aria-label={replyTarget === null ? '评论内容' : `回复 @${replyTarget.authorName} 的内容`}
                    maxLength={WEIBO_COMMENT_MAX_LENGTH}
                    disabled={isSubmitting}
                    className="max-h-32 min-h-14 resize-none bg-background/60 text-xs"
                />
                <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground text-[11px]">
                        {draft.length}/{WEIBO_COMMENT_MAX_LENGTH}
                    </span>
                    <div className="flex items-center gap-2">
                        {/* 同时转发：回复态不提供（回复走评论回复端点，不能顺带转发原博） */}
                        {replyTarget === null ? (
                            <Switch
                                size="sm"
                                checked={shouldRepost}
                                onCheckedChange={setShouldRepost}
                                label="同时转发"
                            />
                        ) : null}
                        <Button
                            size="xs"
                            variant="outline"
                            disabled={!isDraftValid}
                            isLoading={isSubmitting}
                            onClick={() => {
                                void submitComment()
                            }}
                        >
                            {replyTarget === null ? '发布' : '回复'}
                        </Button>
                    </div>
                </div>
            </div>

            {/* 评论列表限高滚动：超出一屏在块内滚动，不把整张卡片继续拉长 */}
            <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
                {isLoading ? (
                    <div className="flex justify-center py-3">
                        <Spinner className="size-4" />
                    </div>
                ) : null}
                {comments.map((comment) => {
                    const authorName = comment.author.name.length > 0 ? comment.author.name : '匿名'
                    const canDelete = viewerUid !== null && comment.author.id === viewerUid
                    const loadedReplies = expandedReplies[comment.id]
                    const shownReplies = loadedReplies?.replies ?? comment.replies
                    const remainingReplies = Math.max(0, comment.replyCount - shownReplies.length)
                    const canLoadMoreReplies =
                        remainingReplies > 0 && (loadedReplies === undefined || loadedReplies.maxId !== null)
                    const isLoadingReplies = expandingIds.includes(comment.id)
                    return (
                        <article key={comment.id} className="flex gap-2 border-b border-border/40 py-2 last:border-b-0">
                            <WeiboAvatar
                                name={comment.author.name}
                                avatarUrl={comment.author.avatarUrl}
                                className="size-7 text-xs"
                            />
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-baseline gap-x-2">
                                    <span className="text-xs font-medium">{authorName}</span>
                                    <span className="text-muted-foreground text-[11px]">
                                        {formatCommentTime(comment)}
                                    </span>
                                </div>
                                <p className="mt-0.5 whitespace-pre-wrap wrap-break-word text-xs leading-relaxed">
                                    <WeiboRichText segments={comment.segments} />
                                </p>
                                {/* 子评论：左边框缩进成一组，被回复者用「回复 @某人」标出，不再嵌套层级 */}
                                {shownReplies.length > 0 || canLoadMoreReplies ? (
                                    <div className="mt-1 flex flex-col gap-1 border-l-2 border-border/60 pl-2">
                                        {shownReplies.map((reply) => (
                                            <div key={reply.id} className="flex gap-1.5">
                                                <WeiboAvatar
                                                    name={reply.author.name}
                                                    avatarUrl={reply.author.avatarUrl}
                                                    className="size-5 text-[10px]"
                                                />
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex flex-wrap items-baseline gap-x-1.5">
                                                        <span className="text-[11px] font-medium">
                                                            {reply.author.name.length > 0 ? reply.author.name : '匿名'}
                                                        </span>
                                                        {reply.replyToName.length > 0 ? (
                                                            <span className="text-[11px] text-muted-foreground">
                                                                回复 @{reply.replyToName}
                                                            </span>
                                                        ) : null}
                                                    </div>
                                                    <p className="whitespace-pre-wrap wrap-break-word text-[11px] leading-relaxed">
                                                        <WeiboRichText segments={reply.segments} />
                                                    </p>
                                                </div>
                                            </div>
                                        ))}
                                        {canLoadMoreReplies ? (
                                            <button
                                                type="button"
                                                className="self-start text-[11px] text-sky-500 transition-colors hover:text-sky-400 disabled:opacity-60"
                                                disabled={isLoadingReplies}
                                                onClick={() => {
                                                    void loadReplies(comment, loadedReplies)
                                                }}
                                            >
                                                {isLoadingReplies ? '正在加载回复…' : `展开 ${remainingReplies} 条回复`}
                                            </button>
                                        ) : null}
                                    </div>
                                ) : null}
                                <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
                                    <button
                                        type="button"
                                        className="transition-colors hover:text-foreground"
                                        onClick={() => {
                                            setReplyTarget({ id: comment.id, authorName })
                                        }}
                                    >
                                        回复
                                    </button>
                                    {canDelete ? (
                                        <button
                                            type="button"
                                            className="transition-colors hover:text-destructive"
                                            onClick={() => {
                                                setPendingDelete(comment)
                                            }}
                                        >
                                            删除
                                        </button>
                                    ) : null}
                                </div>
                            </div>
                            {comment.likes > 0 ? (
                                <span className="shrink-0 text-muted-foreground text-[11px]">{comment.likes}</span>
                            ) : null}
                        </article>
                    )
                })}
                {!isLoading && comments.length === 0 && error === null ? (
                    <p className="py-1 text-muted-foreground text-xs">还没有评论</p>
                ) : null}
                {error !== null ? <p className="py-1 text-destructive text-xs">{error}</p> : null}
            </div>

            <div className="flex items-center gap-2">
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

            {/* 删除确认只有这一个实例：由 pendingDelete 控制，避免每条评论各挂一个弹层 */}
            <AlertDialog
                open={pendingDelete !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        setPendingDelete(null)
                    }
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>删除这条评论？</AlertDialogTitle>
                        <AlertDialogDescription>删除后不可恢复，原微博下的这条评论会一并消失。</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction
                            variant="destructive"
                            disabled={isDestroying}
                            onClick={() => {
                                void destroyComment()
                            }}
                        >
                            {isDestroying ? '正在删除…' : '删除'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </section>
    )
}
