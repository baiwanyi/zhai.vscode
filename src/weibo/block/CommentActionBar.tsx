/**
 * 条目操作行（评论）：时间 + 回复 / 加入 AI 对话 / 点赞 / 删除。
 * 复用约定：排版与按钮骨架交给同目录 WeiboItemActionBar，本文件只注入评论特有的「回复」入口；
 * 每个操作都是可选的，缺省即不渲染——评论传回复 / 加入对话 / 点赞，缺省则只剩时间。
 * 关键约束：删除入口只在传入 onDelete 时渲染（归属最终由上游判定），删除措辞由 deleteLabel 区分；
 * isHoverReveal 原样透传，依赖父级 group 让悬停与键盘聚焦都显形。
 */
import { MessageSquareMore } from 'lucide-react'
import { Button } from '@webview/components/Button'
import { WeiboItemActionBar } from './WeiboItemActionBar'
import type { WeiboCommentLikeController } from '../hooks/useWeiboCommentLike'
import type { JSX } from 'react'

export interface CommentActionBarProps {
    /** 条目时间（ISO 8601）：解析失败时按原始串兜底 */
    createdAt: string
    /** 上游原始时间串：解析失败时直接展示它 */
    createdAtRaw: string
    /** 点赞控制器：只有评论条目传入，缺省不渲染点赞按钮 */
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
        <WeiboItemActionBar
            createdAt={createdAt}
            createdAtRaw={createdAtRaw}
            like={like}
            isAddingToChat={isAddingToChat}
            onAddToChat={onAddToChat}
            onDelete={onDelete}
            deleteLabel={deleteLabel ?? '删除这条评论'}
            isHoverReveal={isHoverReveal}
            className={className}
            extra={
                onReply === undefined ? undefined : (
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        tooltip="回复"
                        aria-label={`回复 ${replyLabel ?? ''}`}
                        onClick={onReply}
                    >
                        <MessageSquareMore className="size-3.5" />
                    </Button>
                )
            }
        />
    )
}
