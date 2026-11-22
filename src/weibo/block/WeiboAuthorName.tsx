/**
 * 作者名 + 认证角标：卡片头、评论与转发条目共用的一处排版，避免各写一遍三元判断。
 * 复用约定：名称兜底取 @webview/weibo/utils/weiboAuthor（默认「匿名」），角标沿用卡片的 BadgeCheck；
 * 字号、字重与颜色由调用方 className 决定，本组件只负责「名称 + 角标」这两段内容。
 * 关键约束：根节点是 inline-flex + align-middle，段落文本流（评论正文行）与 flex 标题行
 * （卡片头）两种上下文都能直接用；align-middle 让被角标撑高的这一块与相邻正文垂直居中，
 * 名称段独占 truncate，角标 shrink-0 不会被压扁；
 * 与后续文本（冒号、@uid）的间距由调用方补，组件自身不加外边距，避免与父级 gap 叠加。
 */
import { cn } from 'cn'
import { BadgeCheck } from 'lucide-react'
import { readWeiboAuthorName } from '@webview/weibo/utils/weiboAuthor'
import type { JSX } from 'react'

export interface WeiboAuthorNameProps {
    /** 上游昵称：空串时回退 fallback */
    name: string
    isVerified: boolean
    /** 空昵称的兜底文案：评论与转发默认「匿名」，卡片头部用「未知作者 / 原作者」 */
    fallback?: string
    className?: string
}

export function WeiboAuthorName({ name, isVerified, fallback, className }: WeiboAuthorNameProps): JSX.Element {
    const displayName = name.length > 0 ? name : (fallback ?? readWeiboAuthorName(''))

    return (
        <span className={cn('inline-flex min-w-0 items-center gap-1 align-middle', className)}>
            <span className="truncate">{displayName}</span>
            {isVerified ? <BadgeCheck className="size-3.5 shrink-0 text-primary" aria-label="已认证" /> : null}
        </span>
    )
}
