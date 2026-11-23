/**
 * 大纲详情区的分层外壳：序号徽标 + 标题 + 一句话说明 + 可选动作，卷纲与章纲视图共用。
 * 复用约定：容器与边框只取语义令牌（border / card），动作槽由调用方塞 Button，本组件不做布局假设。
 * 关键约束：层级只表达「卷纲 → 章纲 → 细纲」的从属关系，不承载数据语义；
 * 新增层级必须同步 SECTION_BADGE，否则徽标缺色、层级再次变得难以分辨。
 */
import { cn } from 'cn'
import type { JSX, ReactNode } from 'react'

/** 三层结构：层级序号与徽标配色，卷纲中性、章纲主色、细纲辅助色 */
export type OutlineSectionLevel = 'volume' | 'chapter' | 'scene'

const SECTION_BADGE: Readonly<Record<OutlineSectionLevel, { index: string; className: string }>> = {
    volume: { index: '1', className: 'bg-muted text-muted-foreground' },
    chapter: { index: '2', className: 'bg-chart-1/15 text-chart-1' },
    scene: { index: '3', className: 'bg-chart-4/15 text-chart-4' },
}

export interface OutlineSectionProps {
    level: OutlineSectionLevel
    title: string
    description: string
    /** 右上角动作：无动作时传 null，与「有动作但此刻禁用」区分 */
    action?: JSX.Element | null
    className?: string
    children: ReactNode
}

export function OutlineSection({
    level,
    title,
    description,
    action,
    className,
    children,
}: OutlineSectionProps): JSX.Element {
    const badge = SECTION_BADGE[level]
    return (
        <section className={cn('flex flex-col rounded-xl border border-border bg-card/40', className)}>
            <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border/60 px-2.5 py-1.5">
                <span
                    className={cn(
                        'flex size-5 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold tabular-nums',
                        badge.className,
                    )}
                    aria-hidden="true"
                >
                    {badge.index}
                </span>
                <h3 className="shrink-0 font-heading font-semibold">{title}</h3>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{description}</span>
                {action}
            </header>
            <div className="flex flex-col gap-2.5 px-2.5 py-2.5">{children}</div>
        </section>
    )
}
