/**
 * 业务徽标：项目统一的徽标组件，可选悬停气泡展示精确口径。
 * 复用约定：外观取 @components/ui/badge 的 Badge（起别名 UiBadge 避开同名），variant 取值与项目徽标语义一致，
 * 省略时按用途取默认值（统计徽标描边、普通徽标实心）；间距字重由 BADGE_CLASS 补充且只在带 tooltip 时叠加，
 * 提示气泡沿用 @webview/components/Tooltip 导出的 TOOLTIP_CLASS；类名经 cn 合并，其余属性透传底层 Badge。
 * 关键约束：带 tooltip 时口径文案必填，胶囊只显示折算值，完整口径必须可悬停查看；
 * 气泡默认向上，仅在容器贴顶时用 side 改向；不带 tooltip 时退化为普通徽标，不包裹 Tooltip。
 */
import { cn } from 'cn'
import { Badge as UiBadge } from '@components/ui/badge'
import { TOOLTIP_CLASS, Tooltip, TooltipContent, TooltipTrigger } from '@webview/components/Tooltip'
import type { ComponentProps, JSX, ReactNode } from 'react'

/** 统计徽标口径：图标与文字留 4px、字重放轻，指针取 pointer 呼应可悬停查精确值；高度沿用底层徽标默认 h-5 */
export const BADGE_CLASS = 'cursor-pointer gap-1 font-light [&>svg]:size-4'

export interface BadgeProps extends ComponentProps<typeof UiBadge> {
    /** 徽标内容：普通徽标直接给文案，统计徽标按「图标 + 折算值」顺序给出 */
    children: ReactNode
    /** 悬停展示的精确口径：省略时退化为普通徽标，不包裹 Tooltip */
    tooltip?: string
    /** 气泡方位：默认向上，装进贴顶容器时再改向 */
    side?: ComponentProps<typeof TooltipContent>['side']
}

export function Badge({
    children,
    tooltip,
    variant,
    side = 'top',
    className,
    ...props
}: BadgeProps): JSX.Element {
    const resolvedVariant = variant ?? (tooltip === undefined ? 'default' : 'outline')
    const badge = (
        <UiBadge
            variant={resolvedVariant}
            className={tooltip === undefined ? className : cn(BADGE_CLASS, className)}
            {...props}
        >
            {children}
        </UiBadge>
    )

    if (tooltip === undefined) {
        return badge
    }
    return (
        <Tooltip>
            <TooltipTrigger asChild>{badge}</TooltipTrigger>
            <TooltipContent side={side} className={TOOLTIP_CLASS}>
                {tooltip}
            </TooltipContent>
        </Tooltip>
    )
}
