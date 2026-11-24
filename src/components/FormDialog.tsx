/**
 * 通用表单对话框：承载「标题 + 可选说明 + 字段组 + 取消/提交」的统一骨架，字段内容由调用方以 children 传入。
 * 复用约定：结构取 @components/ui 的 dialog 与 field-group，取消按钮固定 outline 变体；
 * 提交中统一禁用取消与提交，避免表单在请求未回时被关闭或重复提交。
 * 关键约束：本组件不持有字段状态、也不决定成功后是否关闭——调用方在 onSubmit 里完成提交并自行关闭；
 * 字段的 trim 与空值判定交给 useTrimmedInput，不要把校验散落进本组件；
 * 高度自带上限（视口减 4rem）：标题与底部按钮固定，字段区吃掉剩余高度并独立滚动，长表单不会被挤出视口。
 */
import { cn } from 'cn'
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

/** 弹窗高度上限与三行网格：标题、字段区、按钮分区，字段区（minmax(0,1fr)）在超出时滚动 */
const DIALOG_HEIGHT_CLASS = 'max-h-[calc(100vh-4rem)] grid-rows-[auto_minmax(0,1fr)_auto]'

export interface FormDialogProps {
    open: boolean
    title: string
    /** 说明文案：省略时不渲染描述节点，避免为凑结构补一句废话；需要内联图标时传节点 */
    description?: ReactNode
    /** 提交按钮文案：动词要具体（创建 / 保存 / 开始导入），不用笼统的「确定」 */
    submitLabel: string
    cancelLabel?: string
    /** 提交中：两个按钮同时禁用，字段是否禁用由调用方决定 */
    isSubmitting?: boolean
    /** 校验未通过时为 true，仅禁用提交按钮；与 isSubmitting 分开以便区分原因 */
    isSubmitDisabled?: boolean
    /** 覆盖弹窗宽度等外观（如字段较多的表单用 sm:max-w-md）；高度与滚动已由本组件固定，不要在此重复声明 */
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
            <DialogContent className={cn(DIALOG_HEIGHT_CLASS, contentClassName)}>
                <DialogHeader>
                    <DialogTitle className="text-lg">{title}</DialogTitle>
                    {/* 省略说明时只保留读屏用的描述节点，既不加视觉文案，也不让 Radix 提示缺少描述；
                        空字符串与 undefined 同等处理，避免渲染一段看不见颜色的空段落 */}
                    {description === undefined || description === '' ? (
                        <DialogDescription className="sr-only">{title}</DialogDescription>
                    ) : (
                        <DialogDescription>{description}</DialogDescription>
                    )}
                </DialogHeader>
                {/* 纵向滚动区内不做横向滚动：AI 字段的光晕用 -inset 外扩、
                    绝对定位仍计入溢出，横向 auto 会凭空冒出滚动条，这里显式裁掉 */}
                <FieldGroup className="min-h-0 overflow-x-hidden overflow-y-auto">{children}</FieldGroup>
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
