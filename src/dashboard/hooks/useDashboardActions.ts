/**
 * 仪表盘宿主动作：新建/打开/置顶/删除笔记，笔记本的增删改与偏好，以及回收站的恢复与清除。
 * 复用 @shared/utils/bridge 走宿主协议、@shared/utils/error 的 toErrorText 归一错误文案，结果统一经 sonner 提示。
 * 关键约束：耗时动作进行中记录 pendingAction 阻止重复提交；打开笔记与工作流跳转不占用该状态，
 * 避免顶栏操作区被整体禁用；提示在本层即时发出，页面不再渲染提示行；
 * 删除为批量语义且只移入回收站：成功与失败分别提示，全部失败时不做成功提示，部分成功仍返回已处理路径供页面清理选中态；
 * 笔记本删除会连带把其中笔记移入回收站，成功提示要带上笔记条数，避免用户以为笔记已彻底消失；
 * 索引重建与插件设置由 VS Code 标题栏的「…」菜单直接触发命令，不经过本 Hook。
 */
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import type { HostMethodName } from '@shared/types/messages'
import type {
    CreateNoteRequest,
    CreatedNote,
    DeleteNotesResult,
    NoteDeleteFailure,
    OpenNoteRequest,
    OpenNoteResult,
    PinNotesRequest,
} from '@shared/types/note'
import type {
    CreateNotebookResult,
    DeleteNotebookResult,
    NotebookSort,
    PinNotebooksRequest,
    RenameNotebookResult,
    SetNotebookOpenRequest,
    SetNotebookSortRequest,
} from '@shared/types/notebook'
import type { TrashClearResult, TrashPurgeResult, TrashRestoreResult } from '@shared/types/trash'
import type { OpenWorkflowRequest, OpenWorkflowResult } from '@shared/types/workflow'
import { request } from '@shared/utils/bridge'
import { toErrorText } from '@shared/utils/error'

/** 失败提示：单条给出具体原因，多条只给条数与首条原因，避免提示被逐条刷屏 */
function formatFailureNotice(failures: NoteDeleteFailure[]): string {
    const [first] = failures
    if (first === undefined) {
        return '笔记删除失败'
    }
    return failures.length === 1 ? first.message : `${String(failures.length)} 篇笔记删除失败：${first.message}`
}

/** 回收站操作失败提示：只报条数与首条原因，避免逐条刷屏 */
function formatTrashNotice(action: string, failures: { message: string }[]): string {
    return `${String(failures.length)} 项${action}失败：${failures[0]?.message ?? '未知原因'}`
}

export interface DashboardActionsState {
    pendingAction: string | null
    createNote: (notebookId?: string) => Promise<CreatedNote | null>
    openNote: (path: string) => Promise<void>
    setPinned: (paths: string[], isPinned: boolean) => Promise<void>
    deleteNotes: (paths: string[]) => Promise<DeleteNotesResult | null>
    openWorkflow: (module: string) => Promise<void>
    createNotebook: (name: string) => Promise<boolean>
    renameNotebook: (id: string, name: string) => Promise<boolean>
    deleteNotebook: (id: string) => Promise<DeleteNotebookResult | null>
    pinNotebooks: (ids: string[], isPinned: boolean) => Promise<void>
    setNotebookSort: (sort: NotebookSort) => Promise<boolean>
    setNotebookOpen: (ids: string[]) => Promise<boolean>
    restoreTrash: (ids: string[]) => Promise<TrashRestoreResult | null>
    purgeTrash: (ids: string[]) => Promise<TrashPurgeResult | null>
    clearTrash: () => Promise<TrashClearResult | null>
}

export function useDashboardActions(onCompleted: () => Promise<void>): DashboardActionsState {
    const [pendingAction, setPendingAction] = useState<string | null>(null)

    const runAction = useCallback(
        async (action: string, method: HostMethodName, payload?: unknown): Promise<void> => {
            setPendingAction(action)
            try {
                await request(method, payload)
                await onCompleted()
            } catch (cause) {
                toast.error(toErrorText(cause))
            } finally {
                setPendingAction(null)
            }
        },
        [onCompleted],
    )

    /** 新建空笔记：可指定落点笔记本，成功后刷新统计并回报提示，返回值供页面选中新条目 */
    const createNote = useCallback(
        async (notebookId?: string): Promise<CreatedNote | null> => {
            setPendingAction('create')
            try {
                const payload: CreateNoteRequest = notebookId === undefined ? {} : { notebookId }
                const created = await request<CreatedNote>('note/create', payload)
                await onCompleted()
                toast.success(`已创建笔记：${created.title}`)
                return created
            } catch (cause) {
                toast.error(toErrorText(cause))
                return null
            } finally {
                setPendingAction(null)
            }
        },
        [onCompleted],
    )

    /** 打开笔记：路径存在性由宿主按索引库校验，失败仅提示，不改动列表与统计 */
    const openNote = useCallback(async (path: string): Promise<void> => {
        const payload: OpenNoteRequest = { path }
        try {
            await request<OpenNoteResult>('note/open', payload)
        } catch (cause) {
            toast.error(toErrorText(cause))
        }
    }, [])

    /**
     * 跳转工作流页：仅传递模块意图，由工作流页按模块类型与场景决定渲染真实页面或占位页。
     * 失败仅提示，不改动仪表盘自身状态。
     */
    const openWorkflow = useCallback(async (module: string): Promise<void> => {
        const payload: OpenWorkflowRequest = { module }
        try {
            await request<OpenWorkflowResult>('workflow/open', payload)
        } catch (cause) {
            toast.error(toErrorText(cause))
        }
    }, [])

    const setPinned = useCallback(
        (paths: string[], isPinned: boolean): Promise<void> => {
            const payload: PinNotesRequest = { paths, isPinned }
            return runAction('pin', 'note/pin', payload)
        },
        [runAction],
    )

    /**
     * 批量删除笔记：宿主把笔记移入应用内回收站并以 failures 回传失败原因，本层分别提示后刷新列表与统计。
     * 关键约束：无论成败都先刷新一次快照，使列表与磁盘即时一致；整单异常（参数非法等）只给错误提示并返回 null，
     * 由页面保留待处理项，避免静默丢失用户意图。
     */
    const deleteNotes = useCallback(
        async (paths: string[]): Promise<DeleteNotesResult | null> => {
            setPendingAction('delete')
            try {
                const result = await request<DeleteNotesResult>('note/delete', { paths })
                await onCompleted()
                if (result.trashedPaths.length > 0) {
                    toast.success(`已移入回收站 ${String(result.trashedPaths.length)} 篇笔记`)
                }
                if (result.failures.length > 0) {
                    toast.error(formatFailureNotice(result.failures))
                }
                return result
            } catch (cause) {
                toast.error(toErrorText(cause))
                return null
            } finally {
                setPendingAction(null)
            }
        },
        [onCompleted],
    )

    /** 新建笔记本：成功后关闭弹窗（返回 true），失败保持打开供用户就地改名 */
    const createNotebook = useCallback(
        async (name: string): Promise<boolean> => {
            setPendingAction('notebook-create')
            try {
                const result = await request<CreateNotebookResult>('notebook/create', { name })
                await onCompleted()
                toast.success(`已创建笔记本：${result.notebook.name}`)
                return true
            } catch (cause) {
                toast.error(toErrorText(cause))
                return false
            } finally {
                setPendingAction(null)
            }
        },
        [onCompleted],
    )

    /** 重命名笔记本：目录改名并迁移索引与偏好，成功后关闭弹窗 */
    const renameNotebook = useCallback(
        async (id: string, name: string): Promise<boolean> => {
            setPendingAction('notebook-rename')
            try {
                const result = await request<RenameNotebookResult>('notebook/rename', { id, name })
                await onCompleted()
                toast.success(`笔记本已重命名为：${result.name}`)
                return true
            } catch (cause) {
                toast.error(toErrorText(cause))
                return false
            } finally {
                setPendingAction(null)
            }
        },
        [onCompleted],
    )

    /** 删除笔记本：其中笔记一并移入回收站，成功提示要带上条数 */
    const deleteNotebook = useCallback(
        async (id: string): Promise<DeleteNotebookResult | null> => {
            setPendingAction('notebook-delete')
            try {
                const result = await request<DeleteNotebookResult>('notebook/delete', { id })
                await onCompleted()
                if (result.deleted) {
                    toast.success(
                        result.trashedNotes > 0
                            ? `笔记本已删除，${String(result.trashedNotes)} 篇笔记已移入回收站`
                            : '笔记本已删除',
                    )
                }
                if (result.failures.length > 0) {
                    const failures = result.failures.map((item) => ({ path: item.value, message: item.message }))
                    toast.error(formatFailureNotice(failures))
                }
                return result
            } catch (cause) {
                toast.error(toErrorText(cause))
                return null
            } finally {
                setPendingAction(null)
            }
        },
        [onCompleted],
    )

    const pinNotebooks = useCallback(
        (ids: string[], isPinned: boolean): Promise<void> => {
            const payload: PinNotebooksRequest = { ids, isPinned }
            return runAction('notebook-pin', 'notebook/pin', payload)
        },
        [runAction],
    )

    /**
     * 切换排序：返回是否落库成功，供调用方决定是否回滚本地顺序。
     * 关键约束：这条路径不走 runAction——调用方需要失败信号，而 runAction 只负责提示。
     */
    const setNotebookSort = useCallback(
        async (sort: NotebookSort): Promise<boolean> => {
            setPendingAction('notebook-sort')
            const payload: SetNotebookSortRequest = { sort }
            try {
                await request('notebook/setSort', payload)
                await onCompleted()
                return true
            } catch (cause) {
                toast.error(toErrorText(cause))
                return false
            } finally {
                setPendingAction(null)
            }
        },
        [onCompleted],
    )

    /** 覆盖展开集合：返回是否落库成功，供调用方决定是否回滚展开状态 */
    const setNotebookOpen = useCallback(
        async (ids: string[]): Promise<boolean> => {
            setPendingAction('notebook-open')
            const payload: SetNotebookOpenRequest = { ids }
            try {
                await request('notebook/setOpen', payload)
                await onCompleted()
                return true
            } catch (cause) {
                toast.error(toErrorText(cause))
                return false
            } finally {
                setPendingAction(null)
            }
        },
        [onCompleted],
    )

    /**
     * 恢复回收站条目：宿主按原笔记本还原并重新索引，恢复结果逐条提示。
     * 关键约束：恢复会新增笔记，故无论成败都刷新一次快照，让列表与计数立刻收敛。
     */
    const restoreTrash = useCallback(
        async (ids: string[]): Promise<TrashRestoreResult | null> => {
            setPendingAction('trash-restore')
            try {
                const result = await request<TrashRestoreResult>('trash/restore', { ids })
                await onCompleted()
                if (result.restored.length > 0) {
                    toast.success(`已恢复 ${String(result.restored.length)} 篇笔记`)
                }
                if (result.failures.length > 0) {
                    toast.error(formatTrashNotice('恢复', result.failures))
                }
                return result
            } catch (cause) {
                toast.error(toErrorText(cause))
                return null
            } finally {
                setPendingAction(null)
            }
        },
        [onCompleted],
    )

    /** 彻底清除回收站条目：不可恢复，确认交互由页面承担 */
    const purgeTrash = useCallback(
        async (ids: string[]): Promise<TrashPurgeResult | null> => {
            setPendingAction('trash-purge')
            try {
                const result = await request<TrashPurgeResult>('trash/purge', { ids })
                await onCompleted()
                if (result.purgedIds.length > 0) {
                    toast.success(`已彻底删除 ${String(result.purgedIds.length)} 项`)
                }
                if (result.failures.length > 0) {
                    toast.error(formatTrashNotice('清除', result.failures))
                }
                return result
            } catch (cause) {
                toast.error(toErrorText(cause))
                return null
            } finally {
                setPendingAction(null)
            }
        },
        [onCompleted],
    )

    /** 清空回收站：逐条彻底删除，失败条数随结果提示 */
    const clearTrash = useCallback(async (): Promise<TrashClearResult | null> => {
        setPendingAction('trash-clear')
        try {
            const result = await request<TrashClearResult>('trash/clear')
            await onCompleted()
            if (result.purgedCount > 0) {
                toast.success(`已清空回收站（${String(result.purgedCount)} 项）`)
            }
            if (result.failures.length > 0) {
                toast.error(formatTrashNotice('清除', result.failures))
            }
            return result
        } catch (cause) {
            toast.error(toErrorText(cause))
            return null
        } finally {
            setPendingAction(null)
        }
    }, [onCompleted])

    return {
        pendingAction,
        createNote,
        openNote,
        setPinned,
        deleteNotes,
        openWorkflow,
        createNotebook,
        renameNotebook,
        deleteNotebook,
        pinNotebooks,
        setNotebookSort,
        setNotebookOpen,
        restoreTrash,
        purgeTrash,
        clearTrash,
    }
}
