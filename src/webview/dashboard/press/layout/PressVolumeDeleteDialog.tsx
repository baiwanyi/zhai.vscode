/**
 * 删除卷确认弹窗：明确告知将被移入回收站的卷与章数，二次确认后才发起删除。
 * 复用约定：确认结构取业务公共层的 ConfirmDialog，破坏性动作以 destructive 变体呈现，
 * 与章节删除、作品删除保持同一形态与交互节奏。
 * 关键约束：删除请求由父级发起，本组件只负责拼装文案与提交中禁用；取消或关闭不触达宿主。
 */
import { ConfirmDialog } from '@webview/components/ConfirmDialog'
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
        <ConfirmDialog
            open={open}
            title={`删除${volumeName}？`}
            description={`该卷及其下 ${chapterCount} 章将被移入回收站，可从系统回收站恢复。`}
            confirmLabel="删除"
            isDestructive
            isSubmitting={isSubmitting}
            onOpenChange={onOpenChange}
            onConfirm={onConfirm}
        />
    )
}
