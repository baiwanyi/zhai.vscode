/**
 * 笔记本动作：新建、重命名、删除、置顶与排序/展开偏好落库。
 * 复用 ../core/actionRunner 的请求与提示基础设施、../note/utils 的失败文案，在途态由调用方注入。
 * 关键约束：新建与重命名返回是否成功，调用方据此决定弹窗去留；
 * 排序与展开返回是否落库成功，调用方据此决定本地值是否回滚（失败已提示，不再重复提示）；
 * 删除会连带把其中笔记移入回收站，成功提示要带上笔记条数，避免用户以为笔记已彻底消失。
 */
import { useCallback } from 'react'
import { toast } from 'sonner'
import type {
    CreateNotebookResult,
    DeleteNotebookResult,
    NotebookSort,
    PinNotebooksRequest,
    RenameNotebookResult,
} from '@shared/types/notebook'
import type { PendingScope } from './usePendingAction'
import { callHostRequest } from '../core/actionRunner'
import { formatNoteDeleteFailure } from '../note/utils'

export interface NotebookActionsOptions {
    tracker: PendingScope
    /** 动作落定后的快照刷新：成功才调用 */
    onCompleted: () => Promise<void>
}

export interface NotebookActionsState {
    createNotebook: (name: string) => Promise<boolean>
    renameNotebook: (id: string, name: string) => Promise<boolean>
    deleteNotebook: (id: string) => Promise<DeleteNotebookResult | null>
    pinNotebooks: (ids: string[], isPinned: boolean) => Promise<void>
    setNotebookSort: (sort: NotebookSort) => Promise<boolean>
    setNotebookOpen: (ids: string[]) => Promise<boolean>
}

export function useNotebookActions(options: NotebookActionsOptions): NotebookActionsState {
    const { onCompleted, tracker } = options

    /** 新建笔记本：成功后关闭弹窗（返回 true），失败保持打开供用户就地改名 */
    const createNotebook = useCallback(
        async (name: string): Promise<boolean> => {
            tracker.begin('notebook-create')
            try {
                const result = await callHostRequest<CreateNotebookResult>('notebook/create', { name })
                if (result === null) {
                    return false
                }
                await onCompleted()
                toast.success(`已创建笔记本：${result.notebook.name}`)
                return true
            } finally {
                tracker.end('notebook-create')
            }
        },
        [onCompleted, tracker],
    )

    /** 重命名笔记本：目录改名并迁移索引与偏好，成功后关闭弹窗 */
    const renameNotebook = useCallback(
        async (id: string, name: string): Promise<boolean> => {
            tracker.begin('notebook-rename')
            try {
                const result = await callHostRequest<RenameNotebookResult>('notebook/rename', { id, name })
                if (result === null) {
                    return false
                }
                await onCompleted()
                toast.success(`笔记本已重命名为：${result.name}`)
                return true
            } finally {
                tracker.end('notebook-rename')
            }
        },
        [onCompleted, tracker],
    )

    /** 删除笔记本：其中笔记一并移入回收站，成功提示要带上条数，失败原因逐条汇总后只提示一次 */
    const deleteNotebook = useCallback(
        async (id: string): Promise<DeleteNotebookResult | null> => {
            tracker.begin('notebook-delete')
            try {
                const result = await callHostRequest<DeleteNotebookResult>('notebook/delete', { id })
                if (result === null) {
                    return null
                }
                await onCompleted()
                if (result.deleted) {
                    toast.success(
                        result.trashedNotes > 0
                            ? `笔记本已删除，${String(result.trashedNotes)} 篇笔记已移入回收站`
                            : '笔记本已删除',
                    )
                }
                if (result.failures.length > 0) {
                    toast.error(formatNoteDeleteFailure(result.failures))
                }
                return result
            } finally {
                tracker.end('notebook-delete')
            }
        },
        [onCompleted, tracker],
    )

    /** 批量设置笔记本置顶：结果由数据层提示，成功后刷新快照让排序收敛 */
    const pinNotebooks = useCallback(
        async (ids: string[], isPinned: boolean): Promise<void> => {
            const payload: PinNotebooksRequest = { ids, isPinned }
            tracker.begin('notebook-pin')
            try {
                const result = await callHostRequest('notebook/pin', payload)
                if (result === null) {
                    return
                }
                await onCompleted()
            } finally {
                tracker.end('notebook-pin')
            }
        },
        [onCompleted, tracker],
    )

    /** 切换排序：返回是否落库成功，供调用方决定是否回滚本地顺序 */
    const setNotebookSort = useCallback(
        async (sort: NotebookSort): Promise<boolean> => {
            tracker.begin('notebook-sort')
            try {
                const result = await callHostRequest('notebook/setSort', { sort })
                if (result === null) {
                    return false
                }
                await onCompleted()
                return true
            } finally {
                tracker.end('notebook-sort')
            }
        },
        [onCompleted, tracker],
    )

    /** 覆盖展开集合：返回是否落库成功，供调用方决定是否回滚展开状态 */
    const setNotebookOpen = useCallback(
        async (ids: string[]): Promise<boolean> => {
            tracker.begin('notebook-open')
            try {
                const result = await callHostRequest('notebook/setOpen', { ids })
                if (result === null) {
                    return false
                }
                await onCompleted()
                return true
            } finally {
                tracker.end('notebook-open')
            }
        },
        [onCompleted, tracker],
    )

    return { createNotebook, renameNotebook, deleteNotebook, pinNotebooks, setNotebookSort, setNotebookOpen }
}
