/**
 * 条目操作行骨架：左侧时间（可带追加说明），右侧删除 / 附加操作 / 加入对话 / 点赞。
 * 复用约定：评论行与转发行共用这一份排版，差异项由 timeSuffix、extra 与 deleteLabel 注入；
 * 点赞控制器只要求 isLiked / count / isPending / toggle，评论与转发的控制器都满足。
 * 关键约束：每个操作都可选，缺省即不渲染；删除归属最终由上游判定；
 * 赞数为 0 或未下发（null）都不显示数字，不把「未知」渲染成「0」；
 * 按钮一律图标形态，文案交给 tooltip；isHoverReveal 依赖父级 group，悬停与键盘聚焦都显形。
 */
import { cn } from 'cn'
import { MessageSquareShare, ThumbsUp, Trash2 } from 'lucide-react'
import { Button } from '@webview/components/Button'
import { formatWeiboTime } from '@webview/weibo/utils/weiboTime'
import type { ReactNode, JSX } from 'react'

/** 点赞控制器的最小契约：评论与转发的控制器都满足 */
export interface WeiboItemActionBarLike {
    isLiked: boolean
    /** null 表示上游未下发计数，界面不显示数字 */
    count: number | null
    isPending: boolean
    toggle: () => void
}

export interface WeiboItemActionBarProps {
    /** 条目时间（ISO 8601）：解析失败时按原始串兜底 */
    createdAt: string
    /** 上游原始时间串：解析失败时直接展示它 */
    createdAtRaw: string
    /** 时间后追加的说明，例如「· 原博 12 赞」 */
    timeSuffix?: ReactNode
    /** 点赞控制器：缺省不渲染点赞按钮 */
    like?: WeiboItemActionBarLike
    /** 加入对话的在途态：与 onAddToChat 配套 */
    isAddingToChat?: boolean
    /** 加入 AI 对话入口：不传则不渲染 */
    onAddToChat?: () => void
    /** 删除入口：不传则不渲染 */
    onDelete?: () => void
    /** 删除按钮的无障碍标签：评论与转发措辞不同 */
    deleteLabel: string
    /** 删除与加入对话之间的附加按钮：评论传回复、转发传引用 */
    extra?: ReactNode
    /** 悬停才显形：子评论行用，依赖父级的 group */
    isHoverReveal?: boolean
    /** 行的垂直留白：各条目间距不同 */
    className?: string
}

export function WeiboItemActionBar({
    createdAt,
    createdAtRaw,
    timeSuffix,
    like,
    isAddingToChat = false,
    onAddToChat,
    onDelete,
    deleteLabel,
    extra,
    isHoverReveal = false,
    className,
}: WeiboItemActionBarProps): JSX.Element {
    return (
        <div className={cn('flex items-center justify-between gap-3 text-[11px] text-muted-foreground', className)}>
            <span>
                {formatWeiboTime(createdAt, createdAtRaw)}
                {timeSuffix}
            </span>
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
                        aria-label={deleteLabel}
                        onClick={onDelete}
                    >
                        <Trash2 className="size-3.5" />
                    </Button>
                )}
                {extra}
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
                        {like.count === null || like.count === 0 ? null : (
                            <span className="tabular-nums">{like.count}</span>
                        )}
                    </Button>
                )}
            </div>
        </div>
    )
}
