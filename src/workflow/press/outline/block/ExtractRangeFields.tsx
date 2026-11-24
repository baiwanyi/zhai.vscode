/**
 * 章节范围输入：填起止章序，前后缀「第 / 章」由 InputGroup 的 addon 承担。
 * 复用约定：输入取 ui/input-group 的 InputGroupInput，不在 InputGroup 内用裸 Input；
 * 两个输入共用同一套前后缀，收敛到文件内的 OrderInput，避免重复类名。
 * 关键约束：留空按默认值处理（起始为 1、结束为末章），占位符由调用方给出，组件内不推断章数；
 * 输入值保持字符串原样，归一交给调用方的 clampChapterOrder。
 */
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@components/ui/input-group'
import type { JSX } from 'react'

interface OrderInputProps {
    value: string
    /** 留空时的提示值：起始章不传，结束章传全书章数 */
    placeholder?: string
    /** 输入上限，取全书章数 */
    max: number
    /** 可访问名：区分起始章与结束章 */
    label: string
    onChange: (value: string) => void
}

function OrderInput({ value, placeholder, max, label, onChange }: OrderInputProps): JSX.Element {
    return (
        <InputGroup className="min-w-0 flex-1">
            <InputGroupAddon>
                <InputGroupText>第</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
                type="number"
                min={1}
                max={max}
                value={value}
                placeholder={placeholder}
                aria-label={label}
                onChange={(event) => onChange(event.target.value)}
            />
            <InputGroupAddon align="inline-end">
                <InputGroupText>章</InputGroupText>
            </InputGroupAddon>
        </InputGroup>
    )
}

interface ExtractRangeFieldsProps {
    start: string
    end: string
    /** 输入上限：全书章数 */
    max: number
    /** 结束章留空时的占位提示，通常为末章序号 */
    endPlaceholder: string
    onChangeStart: (value: string) => void
    onChangeEnd: (value: string) => void
}

export function ExtractRangeFields({
    start,
    end,
    max,
    endPlaceholder,
    onChangeStart,
    onChangeEnd,
}: ExtractRangeFieldsProps): JSX.Element {
    return (
        <div className="flex items-center gap-1.5">
            <OrderInput value={start} max={max} label="起始章序号" onChange={onChangeStart} />
            <span className="shrink-0 text-muted-foreground">至</span>
            <OrderInput value={end} max={max} placeholder={endPlaceholder} label="结束章序号" onChange={onChangeEnd} />
        </div>
    )
}
