/**
 * 删除章节确认弹窗：明确告知将被移入回收站的章节标题，二次确认后才发起删除。
 * 复用约定：确认结构取业务公共层的 ConfirmDialog，破坏性动作以 destructive 变体呈现，
 * 与卷删除、作品删除保持一致的交互节奏。
 * 关键约束：删除请求由父级发起，本组件只负责确认与提交中禁用；取消或关闭不触达宿主。
 */
import { ConfirmDialog } from '@webview/components/ConfirmDialog'
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
        <ConfirmDialog
            open={open}
            title={`删除「${chapterTitle}」？`}
            description="该章节文档将被移入回收站，可从系统回收站恢复。"
            confirmLabel="删除"
            isDestructive
            isSubmitting={isSubmitting}
            onOpenChange={onOpenChange}
            onConfirm={onConfirm}
        />
    )
}
