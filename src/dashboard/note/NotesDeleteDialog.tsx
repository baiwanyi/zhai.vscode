/**
 * 删除笔记确认弹窗：单条删除点明标题，批量删除给出条数，二次确认后才发起删除。
 * 复用约定：确认结构取业务公共层的 ConfirmDialog，破坏性动作以 destructive 变体呈现，
 * 与章节删除、作品删除保持一致的交互节奏。
 * 关键约束：删除请求由页面发起，本组件只负责确认与提交中禁用；取消或关闭不触达宿主，
 * 文案按条数分支，避免批量删除时把某一篇标题当成整体对象。
 */
import { ConfirmDialog } from '@webview/components/ConfirmDialog'
import type { JSX } from 'react'

interface NotesDeleteDialogProps {
    open: boolean
    /** 待删除笔记的展示标题，长度即删除条数 */
    titles: string[]
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
}: NotesDeleteDialogProps): JSX.Element {
    const count = titles.length
    const [firstTitle] = titles
    const title =
        count === 1 && firstTitle !== undefined ? `删除「${firstTitle}」？` : `删除选中的 ${String(count)} 篇笔记？`

    return (
        <ConfirmDialog
            open={open}
            title={title}
            description="笔记将被移入系统回收站，可从系统回收站恢复。"
            confirmLabel="删除"
            isDestructive
            isSubmitting={isSubmitting}
            onOpenChange={onOpenChange}
            onConfirm={onConfirm}
        />
    )
}
