/**
 * 仪表盘宿主动作：新建空笔记、打开笔记、批量置顶、索引重建、缓存清理与打开设置，以及尚未接入协议的入口占位反馈。
 * 复用 ../bridge 走宿主协议、@/components/ui/sonner 的 toast 反馈结果，错误经 Error 收窄后提示。
 * 关键约束：耗时动作进行中记录 pendingAction 阻止重复提交；打开笔记不占用该状态，避免顶栏操作区被整体禁用；
 * 提示在本层即时发出，页面不再渲染提示行。
 */
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import type { NoteAction } from '@/shared/types/dashboard'
import type { CreatedNote, OpenNoteRequest, OpenNoteResult, PinNotesRequest } from '@/shared/types/note'
import { request } from '../../bridge'

/** 尚未接入宿主协议的入口 */
export type PendingTarget = 'writing' | 'press'

/** 尚未接入宿主协议的条目操作 */
export type PendingNoteAction = Extract<NoteAction, 'delete'>

/** 各占位入口的提示文案 */
const PENDING_NOTICE: Record<PendingTarget, string> = {
    writing: '写作管理将在后续版本接入',
    press: '公众号管理将在后续版本接入',
}

/** 笔记条目操作的提示文案（仅覆盖未接入协议的动作） */
const NOTE_NOTICE: Record<PendingNoteAction, string> = {
    delete: '删除笔记将在后续版本接入',
}

export interface DashboardActionsState {
    pendingAction: string | null
    createNote: () => Promise<CreatedNote | null>
    openNote: (path: string) => Promise<void>
    setPinned: (paths: string[], isPinned: boolean) => Promise<void>
    rebuild: () => Promise<void>
    clearCache: () => Promise<void>
    openSettings: () => Promise<void>
    showPending: (target: PendingTarget) => void
    showNotePending: (action: PendingNoteAction) => void
}

export function useDashboardActions(onCompleted: () => Promise<void>): DashboardActionsState {
    const [pendingAction, setPendingAction] = useState<string | null>(null)

    const runAction = useCallback(
        async (action: string, method: string, payload?: unknown): Promise<void> => {
            setPendingAction(action)
            try {
                await request(method, payload)
                await onCompleted()
            } catch (cause) {
                toast.error(cause instanceof Error ? cause.message : String(cause))
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
            toast.error(cause instanceof Error ? cause.message : String(cause))
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
            toast.error(cause instanceof Error ? cause.message : String(cause))
        }
    }, [])

    const setPinned = useCallback(
        (paths: string[], isPinned: boolean): Promise<void> => {
            const payload: PinNotesRequest = { paths, isPinned }
            return runAction('pin', 'note/pin', payload)
        },
        [runAction],
    )

    const rebuild = useCallback((): Promise<void> => runAction('rebuild', 'index/rebuild'), [runAction])
    const clearCache = useCallback(
        (): Promise<void> => runAction('clear', 'host/command', 'zhai.clearIndex'),
        [runAction],
    )
    const openSettings = useCallback(
        (): Promise<void> => runAction('settings', 'host/command', 'zhai.openSettings'),
        [runAction],
    )

    const showPending = useCallback((target: PendingTarget): void => {
        toast.info(PENDING_NOTICE[target])
    }, [])

    const showNotePending = useCallback((action: PendingNoteAction): void => {
        toast.info(NOTE_NOTICE[action])
    }, [])

    return {
        pendingAction,
        createNote,
        openNote,
        setPinned,
        rebuild,
        clearCache,
        openSettings,
        showPending,
        showNotePending,
    }
}
