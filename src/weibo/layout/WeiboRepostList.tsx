/**
 * 转发面板：读取谁转发了这条微博（页码分页），并在列表上方提供转发框。
 * 复用约定：weibo/reposts 读取、weibo/repost 提交、weibo/destroy 删除；正文与表情复用 WeiboRichText，
 * 头像复用 WeiboAvatar，删除确认复用 shadcn 的 AlertDialog；
 * 转发框用 shadcn 的 Textarea，附言上限与网页端一致（WEIBO_REPOST_MAX_LENGTH）。
 * 关键约束：父级条件渲染保证每次展开都是新实例，进入即拉第一页；
 * 附言可以为空（纯转发），因此按钮不按内容禁用，只由 maxLength 兜住长度；
 * 「同时评论」开关打开即走转发并评论（is_comment=1），关闭即普通转发（is_comment=0）；
 * 转发成功后清空附言并重拉第一页（新转发在最前），失败弹 toast；
 * 删除入口只给自己的转发：viewerUid 与转发作者 id 相同才渲染，最终归属仍由上游判定；
 * 翻页按页码串行，同时只允许一个在途请求；列表限高滚动，「加载更多」固定在滚动区之外；
 * 纯转发没有附言，正文为空时只渲染作者与时间，不占一行空段落。
 */
import { format } from 'date-fns'
import { BadgeCheck } from 'lucide-react'
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
import { WEIBO_REPOST_MAX_LENGTH } from '@shared/types/weibo'
import type {
    WeiboDestroyStatusResult,
    WeiboRepostCreateResult,
    WeiboRepostItem,
    WeiboRepostsResult,
} from '@shared/types/weibo'
import { request } from '@shared/utils/bridge'
import { toastError, toErrorText } from '@shared/utils/error'
import { Button } from '@webview/components/Button'
import { Switch } from '@webview/components/Switch'
import { WeiboAvatar } from './WeiboAvatar'
import { WeiboRichText } from './WeiboRichText'
import type { JSX, KeyboardEvent } from 'react'

/** 单页条数：与网页端转发列表一致 */
const PAGE_SIZE = 10

/** 请求超时：展开列表与提交转发都是主动等待的场景，与评论同口径 */
const REQUEST_TIMEOUT_MS = 20_000

/** 转发时间：同一年省掉年份，解析失败回退上游原串 */
function formatRepostTime(repost: WeiboRepostItem): string {
    if (repost.createdAt.length === 0) {
        return repost.createdAtRaw
    }
    const date = new Date(repost.createdAt)
    if (Number.isNaN(date.getTime())) {
        return repost.createdAtRaw
    }
    const isSameYear = date.getFullYear() === new Date().getFullYear()
    return format(date, isSameYear ? 'MM-dd HH:mm' : 'yyyy-MM-dd HH:mm')
}

/** 合并分页结果：按转发 id 去重，保持服务端顺序 */
function mergeReposts(current: WeiboRepostItem[], incoming: WeiboRepostItem[]): WeiboRepostItem[] {
    const seen = new Set(current.map((repost) => repost.id))
    const merged = [...current]
    for (const repost of incoming) {
        if (seen.has(repost.id)) {
            continue
        }
        seen.add(repost.id)
        merged.push(repost)
    }
    return merged
}

interface WeiboRepostListProps {
    /** 微博数字 id */
    postId: string
    /** 时间线给出的转发总数：接口未回传时用它兜底展示 */
    totalCount: number
    /** 当前登录账号 uid：与转发作者 id 相同才显示删除入口 */
    viewerUid?: string | null
}

export function WeiboRepostList({ postId, totalCount, viewerUid = null }: WeiboRepostListProps): JSX.Element {
    const [reposts, setReposts] = useState<WeiboRepostItem[]>([])
    const [page, setPage] = useState(1)
    const [hasMore, setHasMore] = useState(false)
    const [isLoading, setIsLoading] = useState(true)
    const [isLoadingMore, setIsLoadingMore] = useState(false)
    const [error, setError] = useState<string | null>(null)
    /** 同时评论：关闭即只转发（is_comment=0），打开即转发并评论（is_comment=1） */
    const [shouldComment, setShouldComment] = useState(false)
    /** 转发附言草稿：转发成功即清空 */
    const [draft, setDraft] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)
    /** 待删除转发：非空即打开确认框，同一时刻只处理一条 */
    const [pendingDelete, setPendingDelete] = useState<WeiboRepostItem | null>(null)
    const [isDestroying, setIsDestroying] = useState(false)
    /** 写操作占位：ref 判定，避开同一帧连点读到旧 state */
    const isSubmittingRef = useRef(false)
    const isDestroyingRef = useRef(false)

    const loadFirstPage = useCallback(async (): Promise<void> => {
        setIsLoading(true)
        setError(null)
        try {
            const result = await request<WeiboRepostsResult>(
                'weibo/reposts',
                { id: postId, page: 1, count: PAGE_SIZE },
                REQUEST_TIMEOUT_MS,
            )
            setReposts(result.reposts)
            setPage(result.page)
            setHasMore(result.hasMore)
        } catch (cause) {
            setError(toErrorText(cause))
        } finally {
            setIsLoading(false)
        }
    }, [postId])

    const loadMore = useCallback(async (): Promise<void> => {
        if (!hasMore || isLoadingMore) {
            return
        }
        setIsLoadingMore(true)
        setError(null)
        try {
            const result = await request<WeiboRepostsResult>(
                'weibo/reposts',
                { id: postId, page: page + 1, count: PAGE_SIZE },
                REQUEST_TIMEOUT_MS,
            )
            setReposts((previous) => mergeReposts(previous, result.reposts))
            setPage(result.page)
            setHasMore(result.hasMore)
        } catch (cause) {
            setError(toErrorText(cause))
        } finally {
            setIsLoadingMore(false)
        }
    }, [hasMore, isLoadingMore, page, postId])

    useEffect(() => {
        void loadFirstPage()
    }, [loadFirstPage])

    /** 提交转发：附言可空，成功后清空输入并重拉第一页，写操作失败弹 toast 让用户重试 */
    const submitRepost = useCallback(async (): Promise<void> => {
        if (isSubmittingRef.current) {
            return
        }
        isSubmittingRef.current = true
        setIsSubmitting(true)
        try {
            await request<WeiboRepostCreateResult>(
                'weibo/repost',
                { id: postId, comment: draft.trim(), mode: shouldComment ? 'repostWithComment' : 'repost' },
                REQUEST_TIMEOUT_MS,
            )
            setDraft('')
            toast.success(shouldComment ? '已转发并评论' : '已转发')
            await loadFirstPage()
        } catch (cause) {
            toastError(cause)
        } finally {
            isSubmittingRef.current = false
            setIsSubmitting(false)
        }
    }, [draft, loadFirstPage, postId, shouldComment])

    /** 删除自己的转发：只在确认框里触发，成功后重拉第一页并收起确认框 */
    const destroyRepost = useCallback(async (): Promise<void> => {
        const target = pendingDelete
        if (target === null || isDestroyingRef.current) {
            return
        }
        isDestroyingRef.current = true
        setIsDestroying(true)
        try {
            await request<WeiboDestroyStatusResult>('weibo/destroy', { id: target.id }, REQUEST_TIMEOUT_MS)
            toast.success('转发已删除')
            setPendingDelete(null)
            await loadFirstPage()
        } catch (cause) {
            toastError(cause)
        } finally {
            isDestroyingRef.current = false
            setIsDestroying(false)
        }
    }, [loadFirstPage, pendingDelete])

    /** Ctrl / Cmd + Enter 直接发送：面板里敲附言不走表单回流 */
    const handleDraftKeyDown = useCallback(
        (event: KeyboardEvent<HTMLTextAreaElement>): void => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault()
                void submitRepost()
            }
        },
        [submitRepost],
    )

    return (
        <section className="flex flex-col gap-2 rounded-lg bg-muted/40 px-3 py-2">
            <p className="text-muted-foreground text-xs">共 {totalCount} 次转发</p>

            {/* 转发框固定在列表上方：附言留空就是纯转发，按钮不做内容校验 */}
            <div className="flex flex-col gap-1">
                <Textarea
                    value={draft}
                    onChange={(event) => {
                        setDraft(event.target.value)
                    }}
                    onKeyDown={handleDraftKeyDown}
                    placeholder="说点什么…留空即纯转发"
                    aria-label="转发附言"
                    maxLength={WEIBO_REPOST_MAX_LENGTH}
                    disabled={isSubmitting}
                    className="max-h-32 min-h-14 resize-none bg-background/60 text-xs"
                />
                <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground text-[11px]">
                        {draft.length}/{WEIBO_REPOST_MAX_LENGTH}
                    </span>
                    <div className="flex items-center gap-2">
                        {/* 同时评论：打开即转发的同时在原博下生成一条评论（is_comment=1） */}
                        <Switch size="sm" checked={shouldComment} onCheckedChange={setShouldComment} label="同时评论" />
                        <Button
                            size="xs"
                            variant="outline"
                            isLoading={isSubmitting}
                            onClick={() => {
                                void submitRepost()
                            }}
                        >
                            发送
                        </Button>
                    </div>
                </div>
            </div>

            {/* 转发列表限高滚动：超出一屏在块内滚动，不把整张卡片继续拉长 */}
            <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
                {isLoading ? (
                    <div className="flex justify-center py-3">
                        <Spinner className="size-4" />
                    </div>
                ) : null}
                {reposts.map((repost) => {
                    const authorName = repost.author.name.length > 0 ? repost.author.name : '匿名'
                    const canDelete = viewerUid !== null && repost.author.id === viewerUid
                    return (
                        <article key={repost.id} className="flex gap-2 border-b border-border/40 py-2 last:border-b-0">
                            <WeiboAvatar
                                name={repost.author.name}
                                avatarUrl={repost.author.avatarUrl}
                                className="size-7 text-xs"
                            />
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-x-1.5">
                                    <span className="text-xs font-medium">{authorName}</span>
                                    {repost.author.isVerified ? (
                                        <BadgeCheck className="size-3.5 shrink-0 text-primary" aria-label="已认证" />
                                    ) : null}
                                    <span className="text-muted-foreground text-[11px]">
                                        {formatRepostTime(repost)}
                                    </span>
                                </div>
                                {repost.segments.length > 0 ? (
                                    <p className="mt-0.5 whitespace-pre-wrap wrap-break-word text-xs leading-relaxed">
                                        <WeiboRichText segments={repost.segments} />
                                    </p>
                                ) : null}
                                {canDelete ? (
                                    <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
                                        <button
                                            type="button"
                                            className="transition-colors hover:text-destructive"
                                            onClick={() => {
                                                setPendingDelete(repost)
                                            }}
                                        >
                                            删除
                                        </button>
                                    </div>
                                ) : null}
                            </div>
                        </article>
                    )
                })}
                {!isLoading && reposts.length === 0 && error === null ? (
                    <p className="py-1 text-muted-foreground text-xs">还没有转发</p>
                ) : null}
                {error !== null ? <p className="py-1 text-destructive text-xs">{error}</p> : null}
            </div>

            <div className="flex items-center gap-2">
                {hasMore ? (
                    <Button size="xs" variant="ghost" onClick={() => void loadMore()} isLoading={isLoadingMore}>
                        加载更多转发
                    </Button>
                ) : null}
                {error !== null && !isLoading ? (
                    <Button size="xs" variant="outline" onClick={() => void loadFirstPage()}>
                        重试
                    </Button>
                ) : null}
            </div>

            {/* 删除确认只有这一个实例：由 pendingDelete 控制，避免每条转发各挂一个弹层 */}
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
                        <AlertDialogTitle>删除这条转发？</AlertDialogTitle>
                        <AlertDialogDescription>
                            删除后不可恢复，原微博下自己的这条转发会一并消失。
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction
                            variant="destructive"
                            disabled={isDestroying}
                            onClick={() => {
                                void destroyRepost()
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
