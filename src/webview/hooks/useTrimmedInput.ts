/**
 * 单值文本输入的 trim 派生：value 保留用户原样输入（不吞中间与首尾空格），trimmedValue 供提交使用。
 * 复用约定：与 @webview/components/FormDialog 搭配，弹窗内只关心「是否为空」与「去掉首尾空白后的值」。
 * 关键约束：isBlank 以 trimmedValue 判定，避免用户只敲空格就能提交；reset 用于关闭弹窗时清理残留文本。
 */
import { useCallback, useState } from 'react'

export interface TrimmedInputState {
    value: string
    trimmedValue: string
    isBlank: boolean
    setValue: (next: string) => void
    reset: () => void
}

export function useTrimmedInput(initialValue = ''): TrimmedInputState {
    const [value, setValue] = useState(initialValue)
    const trimmedValue = value.trim()

    const reset = useCallback((): void => {
        setValue(initialValue)
    }, [initialValue])

    return { value, trimmedValue, isBlank: trimmedValue.length === 0, setValue, reset }
}
