/**
 * 笔记删除弹窗状态机：待删除路径集合、标题反查、确认时序与删除后的结果回报。
 * 复用 useConfirmAction 承载确认（结果落定才关闭，整单失败保留待处理项供原地重试）；
 * 标题由调用方以 resolveTitles 注入，本层不持有笔记清单，也不参与搜索态与分组态的取舍。
 * 关键约束：空集合即弹窗关闭，单条删除是长度为 1 的集合；
 * 整单异常（null）或全部失败（trashedPaths 为空）一律返回 false，不关闭弹窗；
 * 成功只回报已真正移入回收站的路径，选中态清理交由调用方按自身口径决定。
 */
import { useCallback, useMemo, useState } from 'react'
import type { DeleteNotesResult } from '@shared/types/note'
import { useConfirmAction } from './useConfirmAction'

export interface NotesDeleteDialogOptions {
    /** 删除是否在途，供确认弹窗禁用按钮 */
    isSubmitting: boolean
    /** 路径 → 展示标题：反查失败时返回空串，由弹窗退化为按条数陈述 */
    resolveTitles: (paths: readonly string[]) => string[]
    deleteNotes: (paths: string[]) => Promise<DeleteNotesResult | null>
    /** 删除成功后的回调：只传真正移入回收站的路径 */
    onDeleted: (trashedPaths: readonly string[]) => void
}

export interface NotesDeleteDialogState {
    openPaths: readonly string[]
    titles: readonly string[]
    isOpen: boolean
    isSubmitting: boolean
    requestDelete: (paths: readonly string[]) => void
    onOpenChange: (isOpen: boolean) => void
    onConfirm: () => void
}

export function useNotesDeleteDialog(options: NotesDeleteDialogOptions): NotesDeleteDialogState {
    const { deleteNotes, isSubmitting, onDeleted, resolveTitles } = options
    /** 待删除的笔记路径集合：空集合即弹窗关闭，单条删除即长度为 1 的集合 */
    const [openPaths, setOpenPaths] = useState<string[]>([])
    const deleteConfirm = useConfirmAction({ close: () => setOpenPaths([]) })
    const titles = useMemo(() => resolveTitles(openPaths), [openPaths, resolveTitles])

    const requestDelete = useCallback((paths: readonly string[]): void => {
        setOpenPaths([...paths])
    }, [])

    /**
     * 确认删除：整单异常或全部失败时任务返回 false，待处理项保留供原地重试或取消；
     * 结果提示由数据层统一发出，本层只按成功的路径回报。
     */
    const onConfirm = useCallback((): void => {
        const targets = openPaths
        deleteConfirm.confirm(async () => {
            const result = await deleteNotes(targets)
            if (result === null || result.trashedPaths.length === 0) {
                return false
            }
            onDeleted(result.trashedPaths)
            return true
        })
    }, [deleteConfirm, deleteNotes, onDeleted, openPaths])

    return {
        openPaths,
        titles,
        isOpen: openPaths.length > 0,
        isSubmitting,
        requestDelete,
        onOpenChange: deleteConfirm.onOpenChange,
        onConfirm,
    }
}
