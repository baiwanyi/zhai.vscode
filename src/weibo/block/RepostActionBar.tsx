/**
 * 条目操作行（转发）：时间（可带原博赞数）+ 引用 / 加入 AI 对话 / 点赞 / 删除。
 * 复用约定：排版与按钮骨架交给同目录 WeiboItemActionBar，本文件只注入转发特有的「引用」与原博赞数；
 * 点赞态由调用方传入的 useWeiboRepostLike 控制器持有，引用与加入对话只回调触发，本组件不发请求。
 * 关键约束：删除入口只在传入 onDelete 时渲染；转发自身赞数为 0 或未下发都不显示数字（骨架统一处理），
 * 原博赞数单独标在时间后面，两者分开避免误读；已赞呈品红实心。
 */
import { MessageSquareQuote } from 'lucide-react'
import { Button } from '@webview/components/Button'
import { formatWeiboCount } from '@webview/weibo/utils/weiboCount'
import { WeiboItemActionBar } from './WeiboItemActionBar'
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
        <WeiboItemActionBar
            createdAt={createdAt}
            createdAtRaw={createdAtRaw}
            timeSuffix={
                originalLikes === null || originalLikes === 0 ? undefined : (
                    <span className="ml-1">· 原博 {formatWeiboCount(originalLikes)} 赞</span>
                )
            }
            like={like}
            isAddingToChat={isAddingToChat}
            onAddToChat={onAddToChat}
            onDelete={onDelete}
            deleteLabel="删除这条转发"
            className={className}
            extra={
                onQuote === undefined ? undefined : (
                    <Button variant="ghost" size="icon-xs" tooltip="引用" aria-label="引用这条转发" onClick={onQuote}>
                        <MessageSquareQuote className="size-3.5" />
                    </Button>
                )
            }
        />
    )
}
