/**
 * 分区导航项：右侧导航栏中的单个图标按钮，激活时图标提亮并叠加活动栏激活底色。
 * 复用约定：纯受控展示组件，激活标识与选中动作由父级传入；按钮复用 ui/button，悬浮名称复用 ui/tooltip
 * （Provider 由导航栏统一提供）：图标取活动栏主题令牌；悬浮提示在实例上局部反转前景与背景变量得到暗底亮字，
 * 使组件内箭头随气泡同色（不依赖子选择器）；箭头描边声明在 ui/tooltip 内（调用处覆盖箭头不生效），
 * 字号接 UI 字号令牌。
 * 关键约束：纯图标按钮必须带可访问名称；为对齐 VSCode 活动栏的 48×48 直角行，在实例上覆盖按钮默认的
 * 尺寸与圆角，不改共享组件默认值；占位期不设 disabled，保证 hover 与激活反馈可验证。
 */
import { cn } from 'cn'
import { Button } from '@components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@components/ui/tooltip'
import type { JSX, ReactNode } from 'react'

interface WorkflowPressNavItemProps {
    label: string
    icon: ReactNode
    isActive: boolean
    onSelect: () => void
}

export function WorkflowPressNavItem({ label, icon, isActive, onSelect }: WorkflowPressNavItemProps): JSX.Element {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    variant="ghost"
                    className={cn(
                        'size-10 m-1 text-activity-bar-inactive-foreground hover:bg-activity-bar-hover hover:text-activity-bar-foreground active:translate-y-0',
                        isActive && 'bg-activity-bar-active-background text-activity-bar-foreground',
                    )}
                    aria-label={label}
                    aria-current={isActive ? 'page' : undefined}
                    onClick={onSelect}
                >
                    {icon}
                </Button>
            </TooltipTrigger>
            <TooltipContent side="left">{label}</TooltipContent>
        </Tooltip>
    )
}
