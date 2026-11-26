/**
 * 带内嵌标签的文本输入组：章纲卡与场景卡共用，标签显示在输入框内部左侧。
 * 复用约定：容器与输入取 @components/ui/input-group 的 InputGroup + InputGroupInput，
 * 标签取 InputGroupAddon + InputGroupText；id / aria-label 由调用方给出，值全部受控。
 * 关键约束：组件不持有状态、不改写取值，只把输入文本回传给调用方；同一 id 在多场同屏时须带场景 id 前缀避免冲突。
 */
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@components/ui/input-group'
import type { ComponentProps, JSX } from 'react'

export interface InputTextGroupProps extends Omit<ComponentProps<typeof InputGroupInput>, 'value' | 'onChange'> {
    value: string
    label: string
    placeholder: string
    onChange: (value: string) => void
}

/** 文本字段：标签内嵌在输入框左侧，值与变更全部由调用方控制 */
export function InputTextGroup({ value, label, placeholder, onChange, ...props }: InputTextGroupProps): JSX.Element {
    return (
        <InputGroup>
            <InputGroupInput
                {...props}
                value={value}
                placeholder={placeholder}
                aria-label={label}
                onChange={(event) => onChange(event.target.value)}
            />
            <InputGroupAddon align="inline-start">
                <InputGroupText className="text-white pr-2">{label}</InputGroupText>
            </InputGroupAddon>
        </InputGroup>
    )
}
