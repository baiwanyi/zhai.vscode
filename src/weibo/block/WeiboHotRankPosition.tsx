/**
 * 热搜名次：序号与「前三名」高亮，侧栏行与专页行共用这一份排名语义。
 * 复用约定：图标位取 @components/ui/item 的 ItemMedia（variant="icon"），
 * 尺寸由 size 决定（sm 侧栏紧凑、md 整页大字斜体），调用方不再各配宽度与颜色。
 * 关键约束：前三名的判定只在这里（rank <= 3），颜色与字号档位随 size 固定；
 * 其余名次用 muted 前景，并在整行 hover 时提亮，依赖父级 Item 的 group/item。
 */
import { cn } from 'cn'
import { ItemMedia } from '@components/ui/item'
import type { JSX } from 'react'

/** 前三名判定阈值：名次从 1 起，集中在此便于统一调整 */
const TOP_RANK_LIMIT = 3

/** 单个档位的媒体宽度、序号基础类与前三名高亮 */
interface PositionStyle {
    media: string
    index: string
    topRank: string
}

/** 各档位样式：sm 用于侧栏卡片，md 用于整页热搜 */
const POSITION_STYLE: Readonly<Record<'sm' | 'md', PositionStyle>> = {
    sm: {
        media: 'w-8',
        index: 'text-lg tabular-nums transition-colors italic',
        topRank: 'font-semibold text-red-400',
    },
    md: {
        media: 'w-10',
        index: 'text-xl tabular-nums transition-colors italic',
        topRank: 'font-semibold text-red-400',
    },
}

export interface WeiboHotRankPositionProps {
    rank: number
    /** sm 用于侧栏卡片，md 用于整页热搜 */
    size: 'sm' | 'md'
}

export function WeiboHotRankPosition({ rank, size }: WeiboHotRankPositionProps): JSX.Element {
    const style = POSITION_STYLE[size]
    const isTopRank = rank <= TOP_RANK_LIMIT
    return (
        <ItemMedia variant="icon" className={style.media}>
            <span
                className={cn(
                    style.index,
                    isTopRank ? style.topRank : 'text-muted-foreground group-hover/item:text-foreground',
                )}
            >
                {rank}
            </span>
        </ItemMedia>
    )
}
