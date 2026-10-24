/**
 * 快照创建对话框：备注输入 + 保存，结构化文档与章节正文共用。
 * 复用约定：骨架取业务公共层的 FormDialog，备注状态与 trim 取 useTrimmedInput；
 * 提交时回传去除首尾空白后的值，空串按「不填备注」处理。
 * 关键约束：调用方必须传不同的 idPrefix，避免两个面板同时挂载时 label 的 htmlFor 撞车；
 * 关闭对话框即清空备注，防止上次残留的文本被误当成新备注提交。
 */
import { Field, FieldDescription, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { FormDialog } from '@webview/components/FormDialog'
import { useTrimmedInput } from '@webview/hooks/useTrimmedInput'
import type { JSX } from 'react'

interface SnapshotCreateDialogProps {
    open: boolean
    /** 输入框 id 前缀：区分不同面板的同名表单 */
    idPrefix: string
    title: string
    description: string
    placeholder: string
    onOpenChange: (isOpen: boolean) => void
    /** label 缺省表示用户未填备注，由调用方决定如何展示 */
    onSubmit: (label?: string) => void
}

export function SnapshotCreateDialog({
    open,
    idPrefix,
    title,
    description,
    placeholder,
    onOpenChange,
    onSubmit,
}: SnapshotCreateDialogProps): JSX.Element {
    const label = useTrimmedInput()
    const inputId = `${idPrefix}-label`

    const handleOpenChange = (isOpen: boolean): void => {
        if (!isOpen) {
            label.reset()
        }
        onOpenChange(isOpen)
    }

    const handleSubmit = (): void => {
        const value = label.trimmedValue
        label.reset()
        onSubmit(value.length > 0 ? value : undefined)
    }

    return (
        <FormDialog
            open={open}
            title={title}
            description={description}
            submitLabel="保存快照"
            onOpenChange={handleOpenChange}
            onSubmit={handleSubmit}
        >
            <Field>
                <FieldLabel htmlFor={inputId}>备注（可选）</FieldLabel>
                <Input
                    id={inputId}
                    value={label.value}
                    maxLength={60}
                    placeholder={placeholder}
                    onChange={(event) => label.setValue(event.target.value)}
                />
                <FieldDescription>留空表示只记时间，不影响快照内容。</FieldDescription>
            </Field>
        </FormDialog>
    )
}
