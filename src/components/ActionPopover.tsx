/**
 * 行内操作按钮与弹层：锚点用原生 span，手动控制开合，避免包裹无 ref 转发的 Button 导致定位失效；
 * 按下时记下面板状态，避免点击锚点被 Radix 判为外部关闭后又立刻重开。
 * 复用约定：面板内容用 render prop 传入，参数为关闭面板的回调；size / variant 透传 Button，
 * buttonProps 对象透传 Button 其余属性，align 透传 PopoverContent，width 按 xs/md/lg/xl 映射固定宽度；
 * title 与 icon 并列显示。
 * 关键约束：close 在组件卸载后调用不会触发 setState，避免幽灵更新；
 * aria 名经 buttonProps 透传，tooltip 仍承担悬停提示与面板标题，传 title 时按钮从纯图标切换为图标加文案。
 */
'use client'

import { useRef, useState } from 'react'
import { Popover, PopoverAnchor, PopoverContent, PopoverHeader, PopoverTitle } from '@components/ui/popover'
import { Button } from '@webview/components/Button'
import { useIsMounted } from '@webview/hooks/useIsMounted'
import type { ComponentProps, JSX, ReactNode } from 'react'

/** 弹层宽度档位 */
type ActionPopoverWidth = 'xs' | 'md' | 'lg' | 'xl'

/** 宽度档位 → PopoverContent 类名：用常量表避免渲染期拼接 */
const WIDTH_CLASS: Record<ActionPopoverWidth, string> = {
    xs: 'w-48',
    md: 'w-64',
    lg: 'w-80',
    xl: 'w-96',
}

/** 由组件自身管理的 Button 属性：调用方经 buttonProps 传入会被顶层同名 prop 覆盖 */
type ManagedButtonProps = 'size' | 'variant' | 'disabled' | 'children' | 'onClick' | 'title' | 'tooltip'

interface ActionPopoverProps {
    /** 悬停提示与面板标题 */
    tooltip: string
    icon: ReactNode
    /** 按钮文案：传入后与 icon 并列显示，省略时为纯图标按钮 */
    title?: string
    size?: ComponentProps<typeof Button>['size']
    variant?: ComponentProps<typeof Button>['variant']
    /** 其余 Button 属性：className / id / tooltipSide / isLoading 等 */
    buttonProps?: Omit<ComponentProps<typeof Button>, ManagedButtonProps>
    align?: ComponentProps<typeof PopoverContent>['align']
    width?: ActionPopoverWidth
    disabled: boolean
    /** 每次打开前回调：用于把草稿重置为最新值 */
    onOpen?: () => void
    /** 面板内容；参数为关闭面板的回调，供成功写操作后收起 */
    children: (close: () => void) => ReactNode
}

export function ActionPopover({
    tooltip,
    icon,
    title,
    size = 'icon-xs',
    variant = 'ghost',
    buttonProps,
    align = 'end',
    width = 'md',
    disabled,
    onOpen,
    children,
}: ActionPopoverProps): JSX.Element {
    const [isOpen, setIsOpen] = useState(false)
    const wasOpenOnPressRef = useRef(false)
    const isMountedRef = useIsMounted()

    const handlePointerDown = (): void => {
        wasOpenOnPressRef.current = isOpen
    }
    const handleClick = (): void => {
        if (disabled) {
            return
        }
        if (wasOpenOnPressRef.current) {
            wasOpenOnPressRef.current = false
            return
        }
        onOpen?.()
        setIsOpen(true)
    }

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverAnchor asChild>
                <span className="inline-flex" onPointerDown={handlePointerDown} onClick={handleClick}>
                    <Button {...buttonProps} size={size} variant={variant} tooltip={tooltip} disabled={disabled}>
                        {icon}
                        {title === undefined ? null : <span>{title}</span>}
                    </Button>
                </span>
            </PopoverAnchor>
            <PopoverContent align={align} className={WIDTH_CLASS[width]}>
                <PopoverHeader>
                    <PopoverTitle>{tooltip}</PopoverTitle>
                </PopoverHeader>
                {children(() => {
                    if (isMountedRef.current) {
                        setIsOpen(false)
                    }
                })}
            </PopoverContent>
        </Popover>
    )
}

export type { ActionPopoverWidth }
