/**
 * 仪表盘宿主动作：新建空笔记、打开笔记、批量置顶、批量删除笔记与工作流页跳转。
 * 复用 @shared/utils/bridge 走宿主协议、@shared/utils/error 的 toErrorText 归一错误文案，结果统一经 sonner 提示。
 * 关键约束：耗时动作进行中记录 pendingAction 阻止重复提交；打开笔记与工作流跳转不占用该状态，
 * 避免顶栏操作区被整体禁用；提示在本层即时发出，页面不再渲染提示行；
 * 删除为批量语义：成功与失败分别提示，全部失败时不做成功提示，部分成功仍返回已删路径供页面清理选中态；
 * 索引重建与插件设置由 VS Code 标题栏的「…」菜单直接触发命令，不经过本 Hook。
 */
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import type { HostMethodName } from '@shared/types/messages'
import type {
    CreatedNote,
    DeleteNotesRequest,
    DeleteNotesResult,
    NoteDeleteFailure,
    OpenNoteRequest,
    OpenNoteResult,
    PinNotesRequest,
} from '@shared/types/note'
import type { OpenWorkflowRequest, OpenWorkflowResult } from '@shared/types/workflow'
import { request } from '@shared/utils/bridge'
import { toErrorText } from '@shared/utils/error'

/** 成功提示：带上条数，回收站不可用时点明已永久删除，让用户知道能否恢复 */
function formatDeletedNotice(count: number, hasPermanentDelete: boolean): string {
    const base = `已删除 ${String(count)} 篇笔记`
    return hasPermanentDelete ? `${base}（回收站不可用，已永久删除）` : base
}

/** 失败提示：单条给出具体原因，多条只给条数与首条原因，避免提示被逐条刷屏 */
function formatFailureNotice(failures: NoteDeleteFailure[]): string {
    const [first] = failures
    if (first === undefined) {
        return '笔记删除失败'
    }
    return failures.length === 1 ? first.message : `${String(failures.length)} 篇笔记删除失败：${first.message}`
}

export interface DashboardActionsState {
    pendingAction: string | null
    createNote: () => Promise<CreatedNote | null>
    openNote: (path: string) => Promise<void>
    setPinned: (paths: string[], isPinned: boolean) => Promise<void>
    deleteNotes: (paths: string[]) => Promise<DeleteNotesResult | null>
    openWorkflow: (module: string) => Promise<void>
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

    /** 新建空笔记：成功后刷新统计并回报提示，返回值供页面选中新条目 */
    const createNote = useCallback(async (): Promise<CreatedNote | null> => {
        setPendingAction('create')
        try {
            const created = await request<CreatedNote>('note/create')
            await onCompleted()
            toast.success(`已创建笔记：${created.title}`)
            return created
        } catch (cause) {
            toast.error(toErrorText(cause))
            return null
        } finally {
            setPendingAction(null)
        }
    }, [onCompleted])

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
     * 批量删除笔记：宿主逐条删除并以 failures 回传失败原因，本层分别提示后刷新列表与统计。
     * 关键约束：无论成败都先刷新一次快照，使列表与磁盘即时一致；整单异常（参数非法等）只给错误提示并返回 null，
     * 由页面保留待处理项，避免静默丢失用户意图。
     */
    const deleteNotes = useCallback(
        async (paths: string[]): Promise<DeleteNotesResult | null> => {
            setPendingAction('delete')
            try {
                const payload: DeleteNotesRequest = { paths }
                const result = await request<DeleteNotesResult>('note/delete', payload)
                await onCompleted()
                if (result.deletedPaths.length > 0) {
                    toast.success(formatDeletedNotice(result.deletedPaths.length, result.hasPermanentDelete))
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

    return {
        pendingAction,
        createNote,
        openNote,
        setPinned,
        deleteNotes,
        openWorkflow,
    }
}
