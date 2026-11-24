/**
 * 删除笔记确认弹窗：单条删除点明标题，批量删除给出条数，二次确认后才发起删除。
 * 复用约定：确认结构取业务公共层的 AlertDialog，破坏性动作以 destructive 变体呈现，
 * 与章节删除、作品删除保持一致的交互节奏。
 * 关键约束：删除请求由页面发起，本组件只负责确认与提交中禁用；取消或关闭不触达宿主；
 * 笔记只移入应用内回收站，文案必须点明可在回收站恢复，彻底清除才在回收站页完成；
 * 文案按条数分支，避免批量删除时把某一篇标题当成整体对象。
 */
import { AlertDialog } from '@webview/components/AlertDialog'
import type { JSX } from 'react'

interface NotesDeleteDialogProps {
    open: boolean
    /** 待删除笔记的展示标题，长度即删除条数 */
    titles: readonly string[]
    isSubmitting: boolean
    onOpenChange: (open: boolean) => void
    onConfirm: () => void
}

export function NotesDeleteDialog({
    open,
    titles,
    isSubmitting,
    onOpenChange,
    onConfirm,
}: NotesDeleteDialogProps): JSX.Element | null {
    const count = titles.length
    const [firstTitle] = titles
    // 空集合不渲染：宿主误挂载时避免「删除选中的 0 篇笔记」这类错误文案与空提交
    if (count === 0) {
        return null
    }
    // 空标题不点名：反查标题可能落到空字符串，点名后会渲染成「删除「」？」
    const singleTitle = count === 1 && firstTitle !== undefined && firstTitle.trim() !== '' ? firstTitle : null
    const title = singleTitle !== null ? `删除「${singleTitle}」？` : `删除选中的 ${String(count)} 篇笔记？`

    return (
        <AlertDialog
            open={open}
            title={title}
            description="笔记将被移入回收站，可在回收站恢复或彻底删除。"
            confirmLabel="删除"
            isDestructive
            isSubmitting={isSubmitting}
            onOpenChange={onOpenChange}
            onConfirm={onConfirm}
        />
    )
}
