/**
 * 重命名卷弹窗：只收集卷的可读名，序号前缀由宿主保留，避免用户改动排序号。
 * 复用约定：骨架取业务公共层的 FormDialog，文本状态与 trim 判定取 useTrimmedInput；
 * 提交失败时保持打开便于就地修改（由 onSubmit 的布尔结果决定）。
 * 关键约束：表单初始值来自当前卷名，重置由父级在每次打开时更换组件 key 完成，本组件不在 effect 中同步写状态；
 * 前端只做 trim 与空值判定，完整名称白名单由宿主校验；提交中禁用全部控件防止重复提交。
 */
import { Field, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
import { FormDialog } from '@webview/components/FormDialog'
import { useTrimmedInput } from '@webview/hooks/useTrimmedInput'
import type { JSX } from 'react'

interface PressVolumeRenameDialogProps {
    open: boolean
    /** 当前卷名（不含序号前缀），作为输入框初始值 */
    initialName: string
    isSubmitting: boolean
    onOpenChange: (open: boolean) => void
    onSubmit: (name: string) => Promise<boolean>
}

export function PressVolumeRenameDialog({
    open,
    initialName,
    isSubmitting,
    onOpenChange,
    onSubmit,
}: PressVolumeRenameDialogProps): JSX.Element {
    const name = useTrimmedInput(initialName)

    const handleSubmit = async (): Promise<void> => {
        if (name.isBlank || isSubmitting) {
            return
        }
        const isSucceeded = await onSubmit(name.trimmedValue)
        if (isSucceeded) {
            onOpenChange(false)
        }
    }

    return (
        <FormDialog
            open={open}
            title="重命名卷"
            description="仅修改卷名，卷的序号前缀与其中章节保持不变。"
            submitLabel="保存"
            isSubmitting={isSubmitting}
            isSubmitDisabled={name.isBlank}
            onOpenChange={onOpenChange}
            onSubmit={() => void handleSubmit()}
        >
            <Field>
                <FieldLabel htmlFor="press-volume-name">卷名</FieldLabel>
                <Input
                    id="press-volume-name"
                    value={name.value}
                    maxLength={60}
                    placeholder="例如：风起长安"
                    disabled={isSubmitting}
                    onChange={(event) => name.setValue(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            void handleSubmit()
                        }
                    }}
                />
            </Field>
        </FormDialog>
    )
}
