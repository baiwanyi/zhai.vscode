/**
 * 统计胶囊：带悬停精确口径的小徽标，胶囊内容（图标 + 折算值）全部由 children 给出。
 * 复用约定：外观取 ui/badge（高度沿用其默认 h-5），间距与字重由 STAT_BADGE_CLASS 补充，配色由
 * variant 指定且默认 outline 描边以示「次级统计」；胶囊内图标的尺寸与笔触随 children 由调用方给定，
 * 提示气泡沿用 ./Tooltip 导出的 TOOLTIP_CLASS 以与按钮提示同为暗底亮字；类名经 cn 合并、
 * 其余属性透传底层 Badge，与 src/components 内其他公共组件写法一致。
 * 关键约束：tooltip 必填——胶囊只显示折算值，完整口径（估算来源、毫秒构成等）必须可悬停查看；
 * 气泡默认向上，仅在容器贴顶时用 side 改向；胶囊宽度随文案变化，数值格式由调用方统一折算。
 */
import { cn } from 'cn'
import { Badge } from '@components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@components/ui/tooltip'
import { TOOLTIP_CLASS } from './Tooltip'
import type { ComponentProps, JSX, ReactNode } from 'react'

/** 统计胶囊口径：图标与文字留 4px、字重放轻，指针取 pointer 呼应可悬停查精确值；高度不再覆盖，沿用 ui/badge 的 h-5 */
export const STAT_BADGE_CLASS = 'cursor-pointer gap-1 font-light [&>svg]:size-4'

export interface StatBadgeProps extends Omit<ComponentProps<typeof Badge>, 'variant' | 'asChild' | 'children'> {
    /** 胶囊内容：图标 + 折算值按顺序给出；图标须自带尺寸类并标 aria-hidden，否则 lucide 默认 24px 会撑高胶囊 */
    children: ReactNode
    /** 悬停展示的精确口径：估算来源、毫秒数与构成说明都放这里 */
    tooltip: string
    /** 配色变体：取 ui/badge 自带取值，默认 outline；超限 / 告警场景换 secondary 或 destructive */
    variant?: NonNullable<ComponentProps<typeof Badge>['variant']>
    /** 气泡方位：默认向上，装进贴顶容器时再改向 */
    side?: ComponentProps<typeof TooltipContent>['side']
}

export function StatBadge({
    children,
    tooltip,
    variant = 'outline',
    side = 'top',
    className,
    ...props
}: StatBadgeProps): JSX.Element {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Badge variant={variant} className={cn(STAT_BADGE_CLASS, className)} {...props}>
                    {children}
                </Badge>
            </TooltipTrigger>
            <TooltipContent side={side} className={TOOLTIP_CLASS}>
                {tooltip}
            </TooltipContent>
        </Tooltip>
    )
}
