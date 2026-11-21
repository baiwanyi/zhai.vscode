/**
 * 单条评论：作者行、正文、子评论组与回复 / 删除入口，展示用的派生值都在本组件内算。
 * 复用约定：正文与表情取 WeiboRichText，头像取 WeiboAvatar，作者名兜底取 @webview/utils/weiboAuthor，
 * 时间取 @webview/utils/weiboTime；子评论用同文件的 CommentReplyItem，不单独建文件。
 * 关键约束：删除入口是否渲染由调用方给出的 canDelete 决定，本组件不判当前账号（归属最终由上游判定）；
 * 展开按钮只在还有剩余回复且上游仍有游标时出现，加载中禁用并换文案。
 */
import type { WeiboCommentItem, WeiboCommentReply } from '@shared/types/weibo'
import { readWeiboAuthorName } from '@webview/weibo/utils/weiboAuthor'
import { formatWeiboTime } from '@webview/weibo/utils/weiboTime'
import { WeiboAvatar } from './WeiboAvatar'
import { WeiboRichText } from './WeiboRichText'
import type { ExpandedReplies } from '../hooks/useWeiboCommentThread'
import type { JSX } from 'react'

export interface CommentItemProps {
    comment: WeiboCommentItem
    /** 该评论已展开的回复：undefined 表示还没展开过，直接用随列表下发的预览 */
    loadedReplies: ExpandedReplies | undefined
    isLoadingReplies: boolean
    canDelete: boolean
    onReply: () => void
    onDelete: () => void
    onLoadReplies: () => void
}

/** 子评论行：缩进渲染，被回复者用「回复 @某人」标出，不再嵌套层级 */
function CommentReplyItem({ reply }: { reply: WeiboCommentReply }): JSX.Element {
    return (
        <div className="flex gap-1.5">
            <WeiboAvatar name={reply.author.name} avatarUrl={reply.author.avatarUrl} className="size-5" />
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-1.5">
                    <span className="text-[11px] font-medium">{readWeiboAuthorName(reply.author.name)}</span>
                    {reply.replyToName.length > 0 ? (
                        <span className="text-[11px] text-muted-foreground">回复 @{reply.replyToName}</span>
                    ) : null}
                </div>
                <p className="whitespace-pre-wrap wrap-break-word leading-relaxed">
                    <WeiboRichText segments={reply.segments} />
                </p>
            </div>
        </div>
    )
}

export function CommentItem({
    comment,
    loadedReplies,
    isLoadingReplies,
    canDelete,
    onReply,
    onDelete,
    onLoadReplies,
}: CommentItemProps): JSX.Element {
    const authorName = readWeiboAuthorName(comment.author.name)
    const shownReplies = loadedReplies?.replies ?? comment.replies
    const remainingReplies = Math.max(0, comment.replyCount - shownReplies.length)
    const canLoadMoreReplies = remainingReplies > 0 && (loadedReplies === undefined || loadedReplies.maxId !== null)

    return (
        <article className="flex gap-2 border-b border-border/40 py-2 last:border-b-0">
            <WeiboAvatar name={comment.author.name} avatarUrl={comment.author.avatarUrl} className="size-7 text-xs" />
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-xs font-medium">{authorName}</span>
                    <span className="text-muted-foreground">
                        {formatWeiboTime(comment.createdAt, comment.createdAtRaw)}
                    </span>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap wrap-break-word text-xs leading-relaxed">
                    <WeiboRichText segments={comment.segments} />
                </p>
                {shownReplies.length > 0 || canLoadMoreReplies ? (
                    <div className="mt-1 flex flex-col gap-1 border-l-2 border-border/60 pl-2">
                        {shownReplies.map((reply) => (
                            <CommentReplyItem key={reply.id} reply={reply} />
                        ))}
                        {canLoadMoreReplies ? (
                            <button
                                type="button"
                                className="self-start text-sky-500 transition-colors hover:text-sky-400 disabled:opacity-60"
                                disabled={isLoadingReplies}
                                onClick={onLoadReplies}
                            >
                                {isLoadingReplies ? '正在加载回复…' : `展开 ${remainingReplies} 条回复`}
                            </button>
                        ) : null}
                    </div>
                ) : null}
                <div className="mt-1 flex items-center gap-3 text-muted-foreground">
                    <button type="button" className="transition-colors hover:text-foreground" onClick={onReply}>
                        回复
                    </button>
                    {canDelete ? (
                        <button type="button" className="transition-colors hover:text-destructive" onClick={onDelete}>
                            删除
                        </button>
                    ) : null}
                </div>
            </div>
            {comment.likes > 0 ? <span className="shrink-0 text-muted-foreground">{comment.likes}</span> : null}
        </article>
    )
}
