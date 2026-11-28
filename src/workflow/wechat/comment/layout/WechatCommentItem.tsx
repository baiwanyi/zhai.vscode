/**
 * 单条留言：元信息与状态徽标、正文摘要、作者回复，以及详情 / 回复 / 精选 / 删除四个入口。
 * 复用约定：骨架取 @components/ui/item 的槽位，徽标取 blocks/Badge，按钮取 components/Button 的
 * icon-xs + tooltip，回复编辑区复用同目录 WechatCommentReplyForm，文案取 utils/commentText。
 * 关键约束：正文按原文展示、只做行数截断——读者输入不做 Markdown 渲染；
 * 回复草稿由父层持有并只在编辑本条时下发，行内与详情共用同一份，避免两处输入不一致；
 * 只有本条正在写操作时才禁用四个入口，删除只是「请求确认」，真正删除由父层的 AlertDialog 承担。
 */
import { cn } from 'cn'
import { Eye, MessageSquareMore, Star, Trash2 } from 'lucide-react'
import { Item, ItemActions, ItemHeader, ItemTitle } from '@components/ui/item'
import type { WechatCommentSummary } from '@shared/types/wechat'
import { Badge } from '@webview/blocks/Badge'
import { Button } from '@webview/components/Button'
import { WechatCommentReplyForm } from './WechatCommentReplyForm'
import type { WechatCommentActions } from '../types'
import type { JSX } from 'react'
import { hasCommentReply } from '../utils/commentFilter'
import { readCommentMeta, readFanLabel } from '../utils/commentText'

interface WechatCommentItemProps {
    comment: WechatCommentSummary
    isMutating: boolean
    /** 本条留言的回复草稿：null 表示当前没有在编辑本条 */
    replyDraft: string | null
    actions: WechatCommentActions
}

export function WechatCommentItem({ comment, isMutating, replyDraft, actions }: WechatCommentItemProps): JSX.Element {
    const hasReply = hasCommentReply(comment)

    return (
        <Item variant="outline" size="sm" className="flex-col items-stretch gap-1.5" role="listitem">
            <ItemHeader className="gap-2">
                <ItemTitle className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-muted-foreground text-xs">{readCommentMeta(comment)}</span>
                    {comment.isElected && <Badge variant="default">精选</Badge>}
                    {hasReply ? <Badge variant="secondary">已回复</Badge> : null}
                </ItemTitle>
                <ItemActions className="shrink-0 gap-1">
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="详情"
                        tooltip="详情"
                        disabled={isMutating}
                        onClick={() => actions.onOpenDetail(comment)}
                    >
                        <Eye className="size-3.5" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={hasReply ? '修改回复' : '回复'}
                        tooltip={hasReply ? '修改回复' : '回复'}
                        disabled={isMutating}
                        onClick={() => actions.onReply(comment)}
                    >
                        <MessageSquareMore className="size-3.5" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={comment.isElected ? '取消精选' : '设为精选'}
                        aria-pressed={comment.isElected}
                        tooltip={comment.isElected ? '取消精选' : '设为精选'}
                        disabled={isMutating}
                        onClick={() => actions.onToggleElected(comment)}
                    >
                        <Star className={cn('size-3.5', comment.isElected && 'fill-current text-primary')} />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="删除"
                        tooltip="删除"
                        disabled={isMutating}
                        onClick={() => actions.onRequestRemove(comment)}
                    >
                        <Trash2 className="size-3.5 text-destructive" />
                    </Button>
                </ItemActions>
            </ItemHeader>

            <button
                type="button"
                className="cursor-pointer rounded text-left focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                aria-label={`全文（${readFanLabel(comment.openid)}）`}
                onClick={() => actions.onOpenDetail(comment)}
            >
                {/* button 的内容模型只允许短语内容，正文用 span 承载，不能套 p */}
                <span className="line-clamp-3 whitespace-pre-wrap wrap-break-word text-sm">{comment.content}</span>
            </button>

            {hasReply ? (
                <p className="whitespace-pre-wrap wrap-break-word rounded-md bg-muted/40 p-2 text-xs">
                    {`回复：${comment.replyContent ?? ''}`}
                </p>
            ) : null}

            {replyDraft === null ? null : (
                <WechatCommentReplyForm
                    value={replyDraft}
                    isMutating={isMutating}
                    hasReply={hasReply}
                    onChange={actions.onReplyChange}
                    onSubmit={actions.onReplySubmit}
                    onCancel={actions.onReplyCancel}
                />
            )}
        </Item>
    )
}
