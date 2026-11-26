/**
 * 枚举下拉：把「值 / 标签」选项列表渲成 shadcn Select，统一触发器高度与选项分组。
 * 复用约定：控件取 @components/ui/select，选项类型由本组件自定义，不依赖任何业务模块；
 * 额外项（如未分组哨兵）由调用方作为普通选项传入，本组件不内置任何业务取值。
 * 关键约束：值必须是联合类型 T，空值由调用方用哨兵表达；id / aria-label 至少给一个以支撑读屏；
 * 选项 value 不在列表内时忽略该次变更，避免读到脏值；触发器自身属性经 triggerProps 透传，本组件只接管 id / aria-label / className。
 */
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@components/ui/select'
import type { ComponentProps, JSX } from 'react'

export interface OptionSelectOption<T extends string> {
    value: T
    label: string
}

export interface OptionSelectProps<T extends string> extends Omit<
    ComponentProps<typeof Select>,
    'value' | 'onValueChange'
> {
    value: T
    options: readonly OptionSelectOption<T>[]
    onChange: (value: T) => void
    id?: string
    ariaLabel?: string
    className?: string
    /** 触发器自身属性（如 size）：与 id / aria-label / className 冲突时以后者为准 */
    triggerProps?: Omit<ComponentProps<typeof SelectTrigger>, 'id' | 'aria-label' | 'className' | 'children'>
}

/** 枚举下拉：无业务状态，值校验由调用方的 onChange 或选项集合保证 */
export function OptionSelect<T extends string>({
    value,
    options,
    onChange,
    id,
    ariaLabel,
    className = 'w-full',
    triggerProps,
    ...props
}: OptionSelectProps<T>): JSX.Element {
    return (
        <Select
            {...props}
            value={value}
            onValueChange={(next) => {
                const matched = options.find((option) => option.value === next)
                if (matched !== undefined) {
                    onChange(matched.value)
                }
            }}
        >
            <SelectTrigger {...triggerProps} id={id} aria-label={ariaLabel} className={className}>
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                <SelectGroup>
                    {options.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                            {option.label}
                        </SelectItem>
                    ))}
                </SelectGroup>
            </SelectContent>
        </Select>
    )
}
