/**
 * 通用二次确认对话框：删除、恢复等不可逆操作统一走这里，文案与按钮语义由调用方提供。
 * 复用约定：结构取 @components/ui 的 alert-dialog，破坏性操作用 destructive 确认按钮；
 * 两类操作的覆盖范围与后果差异很大，文案不做分支，全部由 title/description 表达。
 * 关键约束：本组件只回调 onConfirm，不自行决定关闭时机——调用方需在回调里先清空待处理项，
 * 避免确认后弹窗短暂停留旧数据；isSubmitting 为真时取消与确认同时禁用，防止重复提交。
 */
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@components/ui/alert-dialog'
import type { JSX } from 'react'

/** 对话框宽度档位：sm 为窄版两列按钮，default 为常规单列按钮 */
export type ConfirmDialogSize = 'default' | 'sm'

export interface ConfirmDialogProps {
    open: boolean
    title: string
    description: string
    confirmLabel: string
    /** 取消按钮文案，默认「取消」；仅删除类操作需要改写的场景才传 */
    cancelLabel?: string
    /** 删除等不可逆操作为 true，确认按钮走 destructive 样式 */
    isDestructive?: boolean
    /** 提交中为 true：两个按钮同时禁用，避免重复触发 */
    isSubmitting?: boolean
    /** 宽度档位，默认 default，与改造前的各弹窗保持一致 */
    size?: ConfirmDialogSize
    onOpenChange: (isOpen: boolean) => void
    onConfirm: () => void
}

export function ConfirmDialog({
    open,
    title,
    description,
    confirmLabel,
    cancelLabel = '取消',
    isDestructive = false,
    isSubmitting = false,
    size = 'default',
    onOpenChange,
    onConfirm,
}: ConfirmDialogProps): JSX.Element {
    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent size={size}>
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-lg">{title}</AlertDialogTitle>
                    <AlertDialogDescription>{description}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={isSubmitting}>{cancelLabel}</AlertDialogCancel>
                    <AlertDialogAction
                        variant={isDestructive ? 'destructive' : 'default'}
                        disabled={isSubmitting}
                        onClick={onConfirm}
                    >
                        {confirmLabel}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
