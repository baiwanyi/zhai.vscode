/**
 * 通用表单对话框：承载「标题 + 说明 + 字段组 + 取消/提交」的统一骨架，字段内容由调用方以 children 传入。
 * 复用约定：结构取 @components/ui 的 dialog 与 field-group，取消按钮固定 outline 变体；
 * 提交中统一禁用取消与提交，避免表单在请求未回时被关闭或重复提交。
 * 关键约束：本组件不持有字段状态、也不决定成功后是否关闭——调用方在 onSubmit 里完成提交并自行关闭；
 * 字段的 trim 与空值判定交给 useTrimmedInput，不要把校验散落进本组件。
 */
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@components/ui/dialog'
import { FieldGroup } from '@components/ui/field'
import { Button } from '@webview/components/Button'
import type { JSX, ReactNode } from 'react'

export interface FormDialogProps {
    open: boolean
    title: string
    description: string
    /** 提交按钮文案：动词要具体（创建 / 保存 / 开始导入），不用笼统的「确定」 */
    submitLabel: string
    cancelLabel?: string
    /** 提交中：两个按钮同时禁用，字段是否禁用由调用方决定 */
    isSubmitting?: boolean
    /** 校验未通过时为 true，仅禁用提交按钮；与 isSubmitting 分开以便区分原因 */
    isSubmitDisabled?: boolean
    /** 覆盖弹窗宽度等外观（如字段较多的表单用 sm:max-w-md），不改变骨架结构 */
    contentClassName?: string
    onOpenChange: (isOpen: boolean) => void
    onSubmit: () => void
    /** 字段区：调用方用 Field + FieldLabel + 控件自行组合 */
    children: ReactNode
}

export function FormDialog({
    open,
    title,
    description,
    submitLabel,
    cancelLabel = '取消',
    isSubmitting = false,
    isSubmitDisabled = false,
    contentClassName,
    onOpenChange,
    onSubmit,
    children,
}: FormDialogProps): JSX.Element {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className={contentClassName}>
                <DialogHeader>
                    <DialogTitle className="text-lg">{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>
                <FieldGroup>{children}</FieldGroup>
                <DialogFooter>
                    <Button variant="outline" disabled={isSubmitting} onClick={() => onOpenChange(false)}>
                        {cancelLabel}
                    </Button>
                    <Button disabled={isSubmitDisabled || isSubmitting} onClick={onSubmit}>
                        {submitLabel}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
