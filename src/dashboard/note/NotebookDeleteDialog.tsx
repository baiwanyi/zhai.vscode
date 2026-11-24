/**
 * 删除笔记本确认弹窗：点明笔记本名与将随之移入回收站的笔记条数，二次确认后才发起删除。
 * 复用约定：确认结构取业务公共层的 AlertDialog，破坏性动作以 destructive 变体呈现。
 * 关键约束：删除请求由页面发起，本组件只负责确认与提交中禁用；取消或关闭不触达宿主；
 * 空笔记本不承诺「可恢复笔记」，文案按条数分支，避免把空目录说成有内容。
 */
import { AlertDialog } from '@webview/components/AlertDialog'
import type { JSX } from 'react'

interface NotebookDeleteDialogProps {
    open: boolean
    notebookName: string
    /** 笔记本内的笔记条数：决定文案是否提到回收站 */
    noteCount: number
    isSubmitting: boolean
    onOpenChange: (open: boolean) => void
    onConfirm: () => void
}

export function NotebookDeleteDialog({
    open,
    notebookName,
    noteCount,
    isSubmitting,
    onOpenChange,
    onConfirm,
}: NotebookDeleteDialogProps): JSX.Element {
    const description =
        noteCount > 0
            ? `其中的 ${String(noteCount)} 篇笔记将一并移入回收站，可在回收站恢复。`
            : '该笔记本是空目录，删除后不可恢复。'

    return (
        <AlertDialog
            open={open}
            title={`删除笔记本「${notebookName}」？`}
            description={description}
            confirmLabel="删除"
            isDestructive
            isSubmitting={isSubmitting}
            onOpenChange={onOpenChange}
            onConfirm={onConfirm}
        />
    )
}
