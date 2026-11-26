/**
 * 热搜徽标：把上游的 icon_desc 与底色渲染成行尾标记，侧栏行与专页行共用。
 * 复用约定：徽标取 @webview/blocks/Badge，前景色由 @shared/utils/color 的 pickReadableForeground 计算，
 * 尺寸通过 size 区分侧栏（sm）与专页（md），调用方不再各写一份样式与颜色分支。
 * 关键约束：iconDesc 为空时返回 null，调用方无需判空；
 * 底色缺失或非法时退化为默认徽标样式（不带行内样式），与图床白名单无关。
 */
import type { WeiboHotRankItem } from '@shared/types/weibo'
import { pickReadableForeground } from '@shared/utils/color'
import { Badge } from '@webview/blocks/Badge'
import type { JSX } from 'react'

/** 徽标尺寸：侧栏窄、专页宽，各给一档 */
const BADGE_SIZE_CLASS: Readonly<Record<'sm' | 'md', string>> = {
    sm: 'h-4 shrink-0 px-1 text-[0.6rem] leading-none',
    md: 'h-5 shrink-0 px-1.5 text-[0.65rem] leading-none',
}

export interface WeiboHotRankBadgeProps {
    item: WeiboHotRankItem
    /** sm 用于侧栏卡片，md 用于整页热搜 */
    size: 'sm' | 'md'
}

export function WeiboHotRankBadge({ item, size }: WeiboHotRankBadgeProps): JSX.Element | null {
    if (item.iconDesc === null) {
        return null
    }
    const color = item.iconDescColor
    return (
        <Badge
            variant={color === null ? 'default' : 'outline'}
            className={BADGE_SIZE_CLASS[size]}
            style={color === null ? undefined : { backgroundColor: color, color: pickReadableForeground(color) }}
        >
            {item.iconDesc}
        </Badge>
    )
}
