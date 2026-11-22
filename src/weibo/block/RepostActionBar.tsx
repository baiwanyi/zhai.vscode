/**
 * 转发操作行：左侧时间、右侧引用 / 添加到 AI 对话 / 点赞 / 删除，与评论操作行同一套视觉。
 * 复用约定：时间由本组件按微博口径格式化（@webview/weibo/utils/weiboTime），按钮取 @webview/components/Button；
 * 点赞态由调用方传入的 useWeiboRepostLike 控制器持有，引用与加入对话只回调触发，本组件不发请求。
 * 关键约束：删除入口只在传入 onDelete 时渲染（归属最终由上游判定）；引用与加入对话同样按需渲染；
 * 转发自身的赞数为 0 时不显示数字（转发普遍无人赞），原博赞数单独标在时间后面；
 * 已赞呈品红实心；图标文案全部交给 tooltip，避免把这一行撑高。
 */
import { cn } from 'cn'
import { MessageSquareQuote, MessageSquareShare, ThumbsUp, Trash2 } from 'lucide-react'
import { Button } from '@webview/components/Button'
import { formatWeiboCount } from '@webview/weibo/utils/weiboCount'
import { formatWeiboTime } from '@webview/weibo/utils/weiboTime'
import type { WeiboRepostLikeController } from '../hooks/useWeiboRepostLike'
import type { JSX } from 'react'

export interface RepostActionBarProps {
    /** 转发时间（ISO 8601）：解析失败时按原始串兜底 */
    createdAt: string
    /** 上游原始时间串：解析失败时直接展示它 */
    createdAtRaw: string
    /** 被转发原微博的点赞数：与按钮上的转发赞数分开显示，null 或 0 时不渲染 */
    originalLikes: number | null
    /** 点赞控制器：每条转发各自一份，状态互不影响 */
    like: WeiboRepostLikeController
    /** 引用入口：把这条转发的作者与附言追加到转发框，缺省不渲染 */
    onQuote?: () => void
    /** 加入对话的在途态：与 onAddToChat 配套，缺省按未在途处理 */
    isAddingToChat?: boolean
    /** 加入 AI 对话入口：不传则不渲染 */
    onAddToChat?: () => void
    /** 删除入口：不传则不渲染 */
    onDelete?: () => void
    /** 行的垂直留白 */
    className?: string
}

export function RepostActionBar({
    createdAt,
    createdAtRaw,
    originalLikes,
    like,
    onQuote,
    isAddingToChat = false,
    onAddToChat,
    onDelete,
    className,
}: RepostActionBarProps): JSX.Element {
    return (
        <div className={cn('flex items-center justify-between gap-3 text-[11px] text-muted-foreground', className)}>
            <span>
                {formatWeiboTime(createdAt, createdAtRaw)}
                {/* 转发自身几乎总是 0 赞，原博赞数更有参考价值；两者分开标注避免误读 */}
                {originalLikes === null || originalLikes === 0 ? null : (
                    <span className="ml-1">· 原博 {formatWeiboCount(originalLikes)} 赞</span>
                )}
            </span>
            <div className="flex items-center gap-1">
                {onDelete === undefined ? null : (
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        className="hover:text-destructive"
                        tooltip="删除"
                        aria-label="删除这条转发"
                        onClick={onDelete}
                    >
                        <Trash2 className="size-3.5" />
                    </Button>
                )}
                {onQuote === undefined ? null : (
                    <Button variant="ghost" size="icon-xs" tooltip="引用" aria-label="引用这条转发" onClick={onQuote}>
                        <MessageSquareQuote className="size-3.5" />
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
                    {/* 0 与未下发都不显示数字：转发赞数普遍为 0，显示出来只会干扰阅读 */}
                    {like.count === null || like.count === 0 ? null : (
                        <span className="tabular-nums">{like.count}</span>
                    )}
                </Button>
            </div>
        </div>
    )
}
