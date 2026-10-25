/**
 * 删除作品确认弹窗：明确告知将被移入回收站的作品、卷数与章数，二次确认后才发起删除。
 * 复用约定：确认结构取业务公共层的 ConfirmDialog，整部作品属最重的破坏性动作，
 * 确认按钮固定走 destructive 变体；触发条件与提交状态由父级下发。
 * 关键约束：删除请求由父级发起，本组件只负责确认与提交中禁用；取消或关闭不触达宿主，
 * 删除成功后由父级跳回作品列表，本组件不自行导航。
 */
import { ConfirmDialog } from '@webview/components/ConfirmDialog'
import type { JSX } from 'react'

interface PressProjectDeleteDialogProps {
    open: boolean
    /** 待删除作品的展示名 */
    projectName: string
    /** 作品下的卷数，用于提示影响范围 */
    volumeCount: number
    /** 作品下的章节总数，用于提示影响范围 */
    chapterCount: number
    isSubmitting: boolean
    onOpenChange: (open: boolean) => void
    onConfirm: () => void
}

export function PressProjectDeleteDialog({
    open,
    projectName,
    volumeCount,
    chapterCount,
    isSubmitting,
    onOpenChange,
    onConfirm,
}: PressProjectDeleteDialogProps): JSX.Element {
    return (
        <ConfirmDialog
            open={open}
            title={`删除《${projectName}》？`}
            description={`整部作品（含设定、人物、大纲与 ${volumeCount} 卷 ${chapterCount} 章）将被移入回收站，可从系统回收站恢复。删除后侧栏写作页会回到作品列表。`}
            confirmLabel="删除作品"
            isDestructive
            isSubmitting={isSubmitting}
            onOpenChange={onOpenChange}
            onConfirm={onConfirm}
        />
    )
}
