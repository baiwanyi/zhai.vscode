/**
 * 删除作品确认弹窗：明确告知将被移入回收站的作品、卷数与章数，二次确认后才发起删除。
 * 复用 @components/ui 的 alert-dialog，整部作品属于最重的破坏性动作，确认按钮用 destructive 变体。
 * 关键约束：删除请求由父级发起，本组件只负责确认与提交中禁用；取消或关闭不触达宿主，
 * 删除成功后由父级跳回作品列表，本组件不自行导航。
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
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>删除《{projectName}》？</AlertDialogTitle>
                    <AlertDialogDescription>
                        整部作品（含设定、人物、大纲与 {volumeCount} 卷 {chapterCount} 章）将被移入回收站，
                        可从系统回收站恢复。删除后侧栏写作页会回到作品列表。
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={isSubmitting}>取消</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" disabled={isSubmitting} onClick={onConfirm}>
                        删除作品
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}
