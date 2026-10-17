/**
 * 删除章节确认弹窗：明确告知将被移入回收站的章节标题，二次确认后才发起删除。
 * 复用 @/components/ui 的 alert-dialog，破坏性动作以 destructive 变体呈现，与卷删除交互保持一致。
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

interface PressChapterDeleteDialogProps {
    open: boolean
    /** 待删除章节的展示标题 */
    chapterTitle: string
    isSubmitting: boolean
    onOpenChange: (open: boolean) => void
    onConfirm: () => void
}

export function PressChapterDeleteDialog({
    open,
    chapterTitle,
    isSubmitting,
    onOpenChange,
    onConfirm,
}: PressChapterDeleteDialogProps): JSX.Element {
    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>删除「{chapterTitle}」？</AlertDialogTitle>
                    <AlertDialogDescription>该章节文档将被移入回收站，可从系统回收站恢复。</AlertDialogDescription>
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
