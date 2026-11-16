/**
 * 笔记本弹窗状态机：新建、重命名、删除三个弹窗的开关目标、提交与确认时序。
 * 复用 useConfirmAction 承载删除确认（结果落定才关闭，整单失败保留弹窗供原地重试）；
 * 新建与重命名共用一个输入弹窗，靠自增 key 让每次打开都拿到空输入框。
 * 关键约束：一个弹窗一个确认实例，删除弹窗不与笔记删除共用；
 * 删除成功后才回调 onDeleted，页面据此清理指向该笔记本笔记的选中态；
 * 在途布尔由页面按 pendingAction 算好后传入，本层不感知动作标识的具体取值。
 */
import { useCallback, useState } from 'react'
import type { DeleteNotebookResult, NotebookSummary } from '@shared/types/notebook'
import { useConfirmAction } from './useConfirmAction'

export interface NotebookDialogsOptions {
    /** 新建笔记本是否在途，供输入弹窗禁用提交 */
    isCreating: boolean
    /** 重命名是否在途 */
    isRenaming: boolean
    /** 删除是否在途 */
    isDeleting: boolean
    createNotebook: (name: string) => Promise<boolean>
    renameNotebook: (id: string, name: string) => Promise<boolean>
    deleteNotebook: (id: string) => Promise<DeleteNotebookResult | null>
    /** 删除成功后的回调：笔记本内笔记已全部移入回收站，调用方据此清理选中态 */
    onDeleted: (notebookId: string) => void
}

export interface NotebookDialogsState {
    isCreateOpen: boolean
    createDialogKey: number
    renameTarget: NotebookSummary | null
    deleteTarget: NotebookSummary | null
    isCreating: boolean
    isRenaming: boolean
    isDeleting: boolean
    openCreate: () => void
    onCreateOpenChange: (isOpen: boolean) => void
    submitCreate: (name: string) => Promise<boolean>
    openRename: (notebook: NotebookSummary) => void
    onRenameOpenChange: (isOpen: boolean) => void
    submitRename: (name: string) => Promise<boolean>
    openDelete: (notebook: NotebookSummary) => void
    onDeleteOpenChange: (isOpen: boolean) => void
    confirmDelete: () => void
}

export function useNotebookDialogs(options: NotebookDialogsOptions): NotebookDialogsState {
    const { createNotebook, deleteNotebook, isCreating, isDeleting, isRenaming, onDeleted, renameNotebook } = options
    /** 新建弹窗的 key：每次打开自增，让输入框回到空值 */
    const [createDialogKey, setCreateDialogKey] = useState(0)
    const [isCreateOpen, setIsCreateOpen] = useState(false)
    const [renameTarget, setRenameTarget] = useState<NotebookSummary | null>(null)
    const [deleteTarget, setDeleteTarget] = useState<NotebookSummary | null>(null)
    const deleteConfirm = useConfirmAction({ close: () => setDeleteTarget(null) })

    const openCreate = useCallback((): void => {
        setCreateDialogKey((previous) => previous + 1)
        setIsCreateOpen(true)
    }, [])

    const onCreateOpenChange = useCallback((isOpen: boolean): void => {
        if (!isOpen) {
            setIsCreateOpen(false)
        }
    }, [])

    const submitCreate = useCallback((name: string): Promise<boolean> => createNotebook(name), [createNotebook])

    const openRename = useCallback((notebook: NotebookSummary): void => {
        setRenameTarget(notebook)
    }, [])

    const onRenameOpenChange = useCallback((isOpen: boolean): void => {
        if (!isOpen) {
            setRenameTarget(null)
        }
    }, [])

    /** 重命名提交：目标在关闭瞬间已被清空时不发请求，直接回报失败 */
    const submitRename = useCallback(
        async (name: string): Promise<boolean> => {
            if (renameTarget === null) {
                return false
            }
            return renameNotebook(renameTarget.id, name)
        },
        [renameNotebook, renameTarget],
    )

    const openDelete = useCallback((notebook: NotebookSummary): void => {
        setDeleteTarget(notebook)
    }, [])

    /**
     * 确认删除笔记本：结果落定后才关闭弹窗，整单失败（含笔记未保存被拒）保留弹窗供重试。
     * 成功时先通知调用方清理选中态，再让确认时序关闭弹窗，避免卸载后状态还指向已不存在的路径。
     */
    const confirmDelete = useCallback((): void => {
        const target = deleteTarget
        if (target === null) {
            return
        }
        deleteConfirm.confirm(async () => {
            const result = await deleteNotebook(target.id)
            if (result === null || !result.deleted) {
                return false
            }
            onDeleted(target.id)
            return true
        })
    }, [deleteConfirm, deleteNotebook, deleteTarget, onDeleted])

    return {
        isCreateOpen,
        createDialogKey,
        renameTarget,
        deleteTarget,
        isCreating,
        isRenaming,
        isDeleting,
        openCreate,
        onCreateOpenChange,
        submitCreate,
        openRename,
        onRenameOpenChange,
        submitRename,
        openDelete,
        onDeleteOpenChange: deleteConfirm.onOpenChange,
        confirmDelete,
    }
}
