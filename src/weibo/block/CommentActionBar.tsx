/**
 * 条目操作行：左侧时间、右侧操作按钮，评论与转发条目共用同一份排版。
 * 复用约定：时间由本组件按微博口径格式化（@webview/weibo/utils/weiboTime），按钮取 @webview/components/Button；
 * 每个操作都是可选的，缺省即不渲染——评论传回复 / 加入对话 / 点赞，转发只传删除。
 * 关键约束：删除入口只在传入 onDelete 时渲染（归属最终由上游判定），删除对象措辞由 deleteLabel 区分；
 * isHoverReveal 依赖父级 group，悬停与键盘聚焦都显形；
 * 按钮一律图标形态，文案由 tooltip 承担，加入对话的在途态交给 isLoading 转圈。
 */
import { cn } from 'cn'
import { MessageSquareMore, MessageSquareShare, ThumbsUp, Trash2 } from 'lucide-react'
import { Button } from '@webview/components/Button'
import { formatWeiboTime } from '@webview/weibo/utils/weiboTime'
import type { WeiboCommentLikeController } from '../hooks/useWeiboCommentLike'
import type { JSX } from 'react'

export interface CommentActionBarProps {
    /** 条目时间（ISO 8601）：解析失败时按原始串兜底 */
    createdAt: string
    /** 上游原始时间串：解析失败时直接展示它 */
    createdAtRaw: string
    /** 点赞控制器：只有评论条目传入，转发没有点赞，缺省不渲染 */
    like?: WeiboCommentLikeController
    /** 加入对话的在途态：与 onAddToChat 配套，缺省按未在途处理 */
    isAddingToChat?: boolean
    /** 删除入口：不传则不渲染 */
    onDelete?: () => void
    /** 删除按钮的无障碍标签：评论与转发的措辞不同 */
    deleteLabel?: string
    /** 回复入口：不传则不渲染 */
    onReply?: () => void
    /** 回复按钮的无障碍标签后缀：被回复者昵称 */
    replyLabel?: string
    /** 加入 AI 对话入口：不传则不渲染 */
    onAddToChat?: () => void
    /** 悬停才显形：子评论行用，依赖父级的 group */
    isHoverReveal?: boolean
    /** 行的垂直留白：各条目间距不同 */
    className?: string
}

export function CommentActionBar({
    createdAt,
    createdAtRaw,
    like,
    isAddingToChat = false,
    onDelete,
    deleteLabel,
    onReply,
    replyLabel,
    onAddToChat,
    isHoverReveal = false,
    className,
}: CommentActionBarProps): JSX.Element {
    return (
        <div className={cn('flex items-center justify-between gap-3 text-[11px] text-muted-foreground', className)}>
            <span>{formatWeiboTime(createdAt, createdAtRaw)}</span>
            <div
                className={cn(
                    'flex items-center gap-1',
                    isHoverReveal && 'opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100',
                )}
            >
                {onDelete === undefined ? null : (
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        className="hover:text-destructive"
                        tooltip="删除"
                        aria-label={deleteLabel ?? '删除这条评论'}
                        onClick={onDelete}
                    >
                        <Trash2 className="size-3.5" />
                    </Button>
                )}
                {onReply === undefined ? null : (
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        tooltip="回复"
                        aria-label={`回复 ${replyLabel ?? ''}`}
                        onClick={onReply}
                    >
                        <MessageSquareMore className="size-3.5" />
                    </Button>
                )}
                {onAddToChat === undefined ? null : (
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        tooltip={isAddingToChat ? '正在添加到对话…' : '添加到 AI 对话'}
                        aria-label="添加到 AI 对话"
                        isLoading={isAddingToChat}
                        onClick={onAddToChat}
                    >
                        <MessageSquareShare className="size-3.5" />
                    </Button>
                )}
                {like === undefined ? null : (
                    <Button
                        variant="ghost"
                        size="xs"
                        className={cn('gap-1 px-1', like.isLiked && 'text-pink-500 hover:text-pink-500')}
                        tooltip={like.isLiked ? '取消赞' : '赞'}
                        aria-label={like.isLiked ? '取消赞' : '赞'}
                        aria-pressed={like.isLiked}
                        disabled={like.isPending}
                        onClick={like.toggle}
                    >
                        <ThumbsUp className="size-3.5" fill={like.isLiked ? 'currentColor' : 'none'} />
                        {like.count > 0 ? like.count : null}
                    </Button>
                )}
            </div>
        </div>
    )
}
