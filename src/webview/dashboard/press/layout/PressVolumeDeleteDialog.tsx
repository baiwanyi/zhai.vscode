/**
 * 删除卷确认弹窗：明确告知将被移入回收站的卷与章数，二次确认后才发起删除。
 * 复用 @/components/ui 的 alert-dialog，破坏性动作以 destructive 变体呈现，与笔记删除交互一致。
 * 关键约束：删除请求由父级发起，本组件只负责确认与提交中禁用；取消或关闭不触达宿主。
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
} from '@/components/ui/alert-dialog'
import type { JSX } from 'react'

interface PressVolumeDeleteDialogProps {
    open: boolean
    /** 待删除卷的展示名 */
    volumeName: string
    /** 该卷下的章节数，用于提示影响范围 */
    chapterCount: number
    isSubmitting: boolean
    onOpenChange: (open: boolean) => void
    onConfirm: () => void
}

export function PressVolumeDeleteDialog({
    open,
    volumeName,
    chapterCount,
    isSubmitting,
    onOpenChange,
    onConfirm,
}: PressVolumeDeleteDialogProps): JSX.Element {
    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>删除{volumeName}？</AlertDialogTitle>
                    <AlertDialogDescription>
                        该卷及其下 {chapterCount} 章将被移入回收站，可从系统回收站恢复。
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={isSubmitting}>取消</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" disabled={isSubmitting} onClick={onConfirm}>
                        删除
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
