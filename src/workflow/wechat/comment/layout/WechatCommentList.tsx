/**
 * 留言列表：承载骨架、读取失败、三种空态与条目组装，并把续载收敛到哨兵 + 手动兜底。
 * 复用约定：条目取同目录 WechatCommentItem，空态取 blocks/Empty，续载取 blocks/LoadMoreSentinel 与
 * blocks/LoadMoreButton，骨架取 @components/ui/item 槽位 + @components/ui/skeleton；筛选结果与计数由父层算好传入。
 * 关键约束：骨架按真实条目的「元信息 / 正文 / 操作区」分块，加载完成时高度不跳；
 * 空态必须区分「没有可查看的文章」「这篇文章没有留言」「筛选后为空」三种成因，
 * 否则用户会把筛选结果误读成平台没数据；筛选态下仍要保留续载入口——未加载的条目里可能命中筛选；
 * 写操作期间的禁用按 mutatingCommentId 落到单条，其他条目仍可操作。
 */
import { MessageSquare } from 'lucide-react'
import { Item, ItemActions, ItemGroup, ItemHeader } from '@components/ui/item'
import { Skeleton } from '@components/ui/skeleton'
import type { WechatCommentSummary } from '@shared/types/wechat'
import { Empty } from '@webview/blocks/Empty'
import { LoadMoreButton } from '@webview/blocks/LoadMoreButton'
import { LoadMoreSentinel } from '@webview/blocks/LoadMoreSentinel'
import { Button } from '@webview/components/Button'
import { WechatCommentItem } from './WechatCommentItem'
import type { CommentFilter, CommentReplyDraft, WechatCommentActions } from '../types'
import type { JSX, RefObject } from 'react'

interface WechatCommentListProps {
    /** 已按筛选维度过滤的条目 */
    comments: WechatCommentSummary[]
    /** 未过滤的已加载条数：区分「没有留言」与「筛选后为空」 */
    loadedCount: number
    filter: CommentFilter
    total: number
    status: 'loading' | 'ready' | 'error'
    error: string | null
    /** 是否存在可查看留言的文章：false 时给出「先群发」的引导 */
    hasIssue: boolean
    hasMore: boolean
    isLoadingMore: boolean
    sentinelRef: RefObject<HTMLDivElement | null>
    isMutating: boolean
    /** 正在写操作的留言 id：只有该条禁用入口，null 表示当前没有 */
    mutatingCommentId: number | null
    /** 当前回复草稿：null 表示没有展开的编辑区 */
    replyDraft: CommentReplyDraft | null
    actions: WechatCommentActions
}

/** 单条骨架：对齐 WechatCommentItem 的「元信息 / 正文 / 操作区」三段，加载完成时高度不跳 */
function SkeletonComment(): JSX.Element {
    return (
        <Item variant="outline" size="sm" className="flex-col items-stretch gap-1.5" role="listitem">
            <ItemHeader className="gap-2">
                <Skeleton className="h-3 w-28" />
                <ItemActions className="shrink-0 gap-1">
                    <Skeleton className="size-8" />
                    <Skeleton className="size-8" />
                    <Skeleton className="size-8" />
                    <Skeleton className="size-8" />
                </ItemActions>
            </ItemHeader>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-1/2" />
        </Item>
    )
}

/** 首屏骨架：两条即可表达「正在读取」，条目再多也只是把同一段占位拉长 */
function CommentSkeleton(): JSX.Element {
    return (
        <ItemGroup>
            <SkeletonComment />
            <SkeletonComment />
        </ItemGroup>
    )
}

export function WechatCommentList({
    comments,
    loadedCount,
    filter,
    total,
    status,
    error,
    hasIssue,
    hasMore,
    isLoadingMore,
    sentinelRef,
    isMutating,
    mutatingCommentId,
    replyDraft,
    actions,
}: WechatCommentListProps): JSX.Element {
    if (status === 'loading') {
        return <CommentSkeleton />
    }

    if (status === 'error') {
        return (
            <Empty icon={MessageSquare} title="读取失败" description={error ?? '稍后重试'} className="h-full">
                <Button variant="outline" onClick={actions.onReload}>
                    重试
                </Button>
            </Empty>
        )
    }

    if (!hasIssue) {
        return (
            <Empty
                icon={MessageSquare}
                title="暂无可查看的文章"
                description="请先群发文章，并确认账号已开通留言功能。"
            />
        )
    }

    /** 空态成因：明确区分「平台没有留言」与「筛选后为空」，避免把筛选结果误读成平台数据 */
    const renderEmpty = (): JSX.Element => {
        if (loadedCount === 0 || filter === 'all') {
            return <Empty title="暂无留言" description="读者留言后显示在这里。" />
        }
        return (
            <Empty
                title="筛选后无留言"
                description={`仅筛选已加载的 ${String(loadedCount)} 条，可继续加载或换筛选条件。`}
            />
        )
    }

    return (
        <div className="flex w-full flex-col gap-2">
            {comments.length === 0 ? (
                renderEmpty()
            ) : (
                <ItemGroup>
                    {comments.map((comment) => (
                        <WechatCommentItem
                            key={comment.id}
                            comment={comment}
                            isMutating={isMutating && mutatingCommentId === comment.id}
                            replyDraft={
                                replyDraft !== null && replyDraft.commentId === comment.id ? replyDraft.content : null
                            }
                            actions={actions}
                        />
                    ))}
                </ItemGroup>
            )}
            {hasMore ? <LoadMoreSentinel sentinelRef={sentinelRef} isLoading={isLoadingMore} /> : null}
            {/* 哨兵负责滚动续载，按钮留作手动兜底：接口偶发失败时用户仍有明确出口 */}
            {hasMore ? (
                <LoadMoreButton
                    remaining={total - loadedCount}
                    label={isLoadingMore ? '加载中…' : `加载更多（${String(loadedCount)}/${String(total)}）`}
                    variant="ghost"
                    onLoadMore={actions.onLoadMore}
                />
            ) : null}
        </div>
    )
}
