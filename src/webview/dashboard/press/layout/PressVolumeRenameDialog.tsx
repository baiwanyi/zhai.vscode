/**
 * 重命名卷弹窗：只收集卷的可读名，序号前缀由宿主保留，避免用户改动排序号。
 * 复用 @components/ui 的 dialog、field、input，提交失败时保持打开便于就地修改。
 * 关键约束：表单初始值来自当前卷名，重置由父级在每次打开时更换组件 key 完成，本组件不在 effect 中同步写状态；
 * 前端只做 trim 与空值判定，完整名称白名单由宿主校验；提交中禁用全部控件防止重复提交。
 */
import { useState } from 'react'
import { Button } from '@components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@components/ui/field'
import { Input } from '@components/ui/input'
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
    const [name, setName] = useState(initialName)
    const trimmedName = name.trim()
    const isSubmitDisabled = isSubmitting || trimmedName.length === 0

    const handleSubmit = async (): Promise<void> => {
        if (isSubmitDisabled) {
            return
        }
        const isSucceeded = await onSubmit(trimmedName)
        if (isSucceeded) {
            onOpenChange(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>重命名卷</DialogTitle>
                    <DialogDescription>仅修改卷名，卷的序号前缀与其中章节保持不变。</DialogDescription>
                </DialogHeader>
                <FieldGroup>
                    <Field>
                        <FieldLabel htmlFor="press-volume-name">卷名</FieldLabel>
                        <Input
                            id="press-volume-name"
                            value={name}
                            maxLength={60}
                            placeholder="例如：风起长安"
                            disabled={isSubmitting}
                            onChange={(event) => setName(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    void handleSubmit()
                                }
                            }}
                        />
                    </Field>
                </FieldGroup>
                <DialogFooter>
                    <Button variant="outline" disabled={isSubmitting} onClick={() => onOpenChange(false)}>
                        取消
                    </Button>
                    <Button disabled={isSubmitDisabled} onClick={() => void handleSubmit()}>
                        保存
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
