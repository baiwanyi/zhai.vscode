/**
 * 通用开关：在 @components/ui/switch 之上补齐文字标签与悬停提示，其余属性原样透传底座。
 * 复用约定：label 以 htmlFor 关联开关（未传 id 时用 useId 兜底），点标签等价于点开关；
 * tooltip 走受控 Tooltip——指针进入或键盘聚焦即开、离开或失焦即关，不套 Radix 的延时策略；
 * tooltipSide 仅在提示需要避开所在容器时传，气泡沿用 Button 的固定暗底亮字，见 TOOLTIP_CLASS。
 * 关键约束：TooltipTrigger 会把自身 data-state 合并进子元素，与开关的选中态同一属性相撞，
 * 故由一层 inline-flex 的 span 承接触发层与事件（disabled 的按钮不派发指针事件，只有外层兜住
 * 才提示得出停用原因）；切换开关不关闭提示——指针仍在开关上不会再次触发进入事件，关掉就弹不回来。
 */
'use client'

import { useCallback, useId, useState } from 'react'
import { Label } from '@components/ui/label'
import { Switch as ShadcnSwitch } from '@components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@components/ui/tooltip'
import type { ComponentProps, JSX, ReactNode } from 'react'

interface SwitchProps extends ComponentProps<typeof ShadcnSwitch> {
    /** 开关右侧文字标签：传入后与开关同排渲染，点击标签等价于点击开关 */
    label?: ReactNode
    /** 悬停 / 聚焦提示文案：传入后开关由受控 Tooltip 包裹，未传则不引入任何提示层 */
    tooltip?: string
    /** 提示框方位，省略时由 Radix 按可用空间自动选择 */
    tooltipSide?: ComponentProps<typeof TooltipContent>['side']
}

/** 与 Button 保持一致：气泡固定暗底亮字，箭头继承同一组变量后自动同色 */
const TOOLTIP_CLASS = '[--foreground:#1E1E1E] [--background:var(--background)]'

function Switch({ id, label, tooltip, tooltipSide, ...rest }: SwitchProps): JSX.Element {
    const [isTooltipOpen, setIsTooltipOpen] = useState(false)
    const generatedId = useId()
    // Label 靠 htmlFor 关联到开关，成对出现才不会点了没反应；调用方未给 id 时用 useId 兜住
    const switchId = id ?? (label ? generatedId : undefined)
    // 停用态由外层 group 转达给 Label：Label 默认只在 group-data-[disabled=true] 下变灰
    const isDisabled = rest.disabled === true

    // 悬停与键盘聚焦都算「指向开关」：触摸设备没有 hover，键盘用户也应有提示
    const openTooltip = useCallback((): void => {
        setIsTooltipOpen(true)
    }, [])

    const closeTooltip = useCallback((): void => {
        setIsTooltipOpen(false)
    }, [])

    const switchNode = <ShadcnSwitch {...rest} id={switchId} />

    const control = tooltip ? (
        <Tooltip open={isTooltipOpen} onOpenChange={setIsTooltipOpen}>
            <TooltipTrigger asChild>
                {/* 触发层的 data-state 会覆盖开关自身的选中态，故由 span 承接；开关本体不参与属性合并 */}
                <span
                    className="inline-flex"
                    onPointerEnter={openTooltip}
                    onPointerLeave={closeTooltip}
                    onFocus={openTooltip}
                    onBlur={closeTooltip}
                >
                    {switchNode}
                </span>
            </TooltipTrigger>
            <TooltipContent side={tooltipSide} className={TOOLTIP_CLASS}>
                {tooltip}
            </TooltipContent>
        </Tooltip>
    ) : (
        switchNode
    )

    if (!label) {
        return control
    }

    return (
        <span className="group inline-flex items-center gap-1.5" data-disabled={isDisabled ? true : undefined}>
            {control}
            <Label htmlFor={switchId} className="text-muted-foreground">
                {label}
            </Label>
        </span>
    )
}

export { Switch, type SwitchProps }
