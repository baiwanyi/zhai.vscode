/**
 * 通用按钮：在 @components/ui/button 之上补齐悬停提示、加载态与点击时序三件事。
 * 复用约定：variant / size / asChild 原样透传底层 Button，图标与文案由调用方经 children 给出；
 * 传 tooltip 时用受控 Tooltip 包裹，指针进入或键盘聚焦即开、离开或失焦即关，不走 Radix 的延时策略；
 * tooltipSide 仅在提示需要避开所在容器时使用（如活动栏竖排导航用 left），默认由 Radix 自动定位；
 * 气泡固定暗底亮字（不随明暗主题翻转），通过局部重写前景/背景变量实现，箭头随之同色，见 TOOLTIP_CLASS。
 * 交互上统一取消按下位移：底层 cva 的 active 位移用同修饰符的 translate-y-0 覆盖，点击时位置保持稳定。
 * 关键约束：disabled 与指针处理器必须在解构中取出后显式声明，否则会被 {...rest} 覆盖，
 * 造成加载态失效或 tooltip 卡在打开态；asChild 依赖唯一子元素，加载态只置
 * aria-busy 而不替换 children，避免 Slot 契约被破坏；禁用中的按钮不派发指针事件，tooltip 不会弹出；
 * 加载态必须保留原 children 的占位宽度并用绝对定位覆盖 Spinner，否则按钮会随文本消失而塌缩，
 * 两侧对齐的工具栏（如页脚）会跟着重排，点一下就抖。
 */
'use client'

import { cn } from 'cn'
import { useCallback, useState } from 'react'
import { Button as ShadcnButton, type buttonVariants } from '@components/ui/button'
import { Spinner } from '@components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@components/ui/tooltip'
import type { VariantProps } from 'class-variance-authority'
import type { ComponentProps, FocusEvent, JSX, MouseEvent, PointerEvent, ReactNode } from 'react'

interface ButtonProps extends ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
    asChild?: boolean
    /** 悬停 / 聚焦提示文案：传入后按钮由受控 Tooltip 包裹，未传则不引入任何提示层 */
    tooltip?: string
    /** 提示框方位，省略时由 Radix 按可用空间自动选择 */
    tooltipSide?: ComponentProps<typeof TooltipContent>['side']
    isLoading?: boolean
    children?: ReactNode
}

/**
 * 提示气泡统一暗底亮字：直接重写局部前景/背景变量，气泡背景取暗色、文字取亮色。
 * 底层的箭头是独立 svg（bg-foreground / fill-foreground），继承同一组变量后自动同色，
 * 不必对箭头写子选择器，也不会因特异性差异漏掉箭头。
 */
export const TOOLTIP_CLASS = '[--foreground:#1E1E1E] [--background:var(--background)]'

function Button({
    className,
    variant,
    size,
    asChild = false,
    tooltip,
    tooltipSide,
    children,
    onClick,
    onFocus,
    onBlur,
    onPointerEnter,
    onPointerLeave,
    disabled = false,
    isLoading = false,
    ...rest
}: ButtonProps): JSX.Element {
    const [isTooltipOpen, setIsTooltipOpen] = useState(false)

    // 悬停与键盘聚焦都算「指向按钮」：触摸设备没有 hover，键盘用户也应有提示
    function handlePointerEnter(event: PointerEvent<HTMLButtonElement>): void {
        if (tooltip) {
            setIsTooltipOpen(true)
        }
        onPointerEnter?.(event)
    }

    function handlePointerLeave(event: PointerEvent<HTMLButtonElement>): void {
        setIsTooltipOpen(false)
        onPointerLeave?.(event)
    }

    function handleFocus(event: FocusEvent<HTMLButtonElement>): void {
        if (tooltip) {
            setIsTooltipOpen(true)
        }
        onFocus?.(event)
    }

    function handleBlur(event: FocusEvent<HTMLButtonElement>): void {
        setIsTooltipOpen(false)
        onBlur?.(event)
    }

    const handleClick = useCallback(
        (event: MouseEvent<HTMLButtonElement>) => {
            // 加载态直接丢弃点击：asChild 等无法靠 disabled 兜住的场景同样能防重复提交
            if (isLoading) {
                return
            }
            setIsTooltipOpen(false)
            onClick?.(event)
        },
        [isLoading, onClick],
    )

    // asChild 由 Slot 渲染唯一子元素，加载态替换 children 会破坏该契约，故只在普通按钮下换 Spinner
    const content = isLoading && !asChild ? <Spinner /> : children

    const button = (
        <ShadcnButton
            {...rest}
            variant={variant}
            size={size}
            asChild={asChild}
            className={cn('relative active:not-aria-[haspopup]:translate-y-0', className)}
            onClick={handleClick}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onPointerEnter={handlePointerEnter}
            onPointerLeave={handlePointerLeave}
            disabled={isLoading || disabled}
            aria-busy={isLoading || undefined}
        >
            {content}
        </ShadcnButton>
    )

    if (tooltip) {
        return (
            <Tooltip open={isTooltipOpen} onOpenChange={setIsTooltipOpen}>
                <TooltipTrigger asChild>{button}</TooltipTrigger>
                {/* 提示统一暗底亮字：shadcn 默认取 foreground 作底，暗色主题下会翻成浅底；
                    箭头颜色写死在 ui/tooltip 内，只能用子选择器跟随同色 */}
                <TooltipContent side={tooltipSide} className={TOOLTIP_CLASS}>
                    {tooltip}
                </TooltipContent>
            </Tooltip>
        )
    }

    return button
}

export { Button, type ButtonProps }
