/**
 * 快照确认对话框：恢复与删除共用同一套二次确认结构，只由调用方提供文案与确认按钮语义。
 * 复用约定：结构取 @components/ui 的 alert-dialog，破坏性操作用 destructive 确认按钮；
 * 文案一律由调用方传入——两类操作的覆盖范围与后果差异很大，不在组件内做分支。
 * 关键约束：本组件只回调 onConfirm，不自行决定关闭时机；调用方需在回调里先清空待处理项，
 * 避免确认后弹窗短暂停留旧数据上。
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

interface SnapshotConfirmDialogProps {
    open: boolean
    title: string
    description: string
    confirmLabel: string
    /** 删除等不可逆操作为 true，确认按钮走 destructive 样式 */
    isDestructive?: boolean
    onOpenChange: (isOpen: boolean) => void
    onConfirm: () => void
}

export function SnapshotConfirmDialog({
    open,
    title,
    description,
    confirmLabel,
    isDestructive = false,
    onOpenChange,
    onConfirm,
}: SnapshotConfirmDialogProps): JSX.Element {
    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent size="sm">
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-lg">{title}</AlertDialogTitle>
                    <AlertDialogDescription>{description}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction variant={isDestructive ? 'destructive' : 'default'} onClick={onConfirm}>
                        {confirmLabel}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
