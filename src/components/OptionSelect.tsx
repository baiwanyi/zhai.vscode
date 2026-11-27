/**
 * 枚举下拉：把「值 / 标签」选项列表渲成 shadcn Select，统一触发器高度与选项分组。
 * 复用约定：控件取 @components/ui/select，选项类型由本组件自定义，不依赖任何业务模块；
 * 额外项（如未分组哨兵）由调用方作为普通选项传入，本组件不内置任何业务取值。
 * 关键约束：值必须是联合类型 T，空值由调用方用哨兵表达；id / label 至少给一个以支撑读屏；
 * 选项 value 不在列表内时忽略该次变更；触发器尺寸由 size 指定，下拉面板固定限高。
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
    /** 读屏标签 */
    label?: string
    className?: string
    /** 触发器尺寸 */
    size?: 'sm' | 'default'
}

/** 枚举下拉：无业务状态，值校验由调用方的 onChange 或选项集合保证 */
export function OptionSelect<T extends string>({
    value,
    options,
    onChange,
    id,
    label,
    className = 'w-full',
    size = 'default',
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
            <SelectTrigger size={size} id={id} aria-label={label} className={className}>
                <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-48">
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
