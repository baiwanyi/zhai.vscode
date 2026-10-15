/**
 * 仪表盘宿主动作：新建空笔记、批量置顶、索引重建、缓存清理与打开设置，以及尚未接入协议的入口占位反馈。
 * 复用 ../bridge 走宿主协议；错误与提示分列，避免占位说明覆盖真实的失败信息。
 * 关键约束：占位提示定时自动消失，定时器随卸载清理；动作进行中记录 pendingAction 阻止重复提交；
 * 置顶为宿主持久化的偏好，完成后统一刷新统计以让列表顺序收敛。
 */
import { useCallback, useEffect, useState } from 'react'
import type { NoteAction } from '@/shared/types/dashboard'
import type { CreatedNote, PinNotesRequest } from '@/shared/types/note'
import { request } from '../../bridge'

/** 占位提示的保留时长 */
const NOTICE_TIMEOUT_MS = 4000

/** 尚未接入宿主协议的入口 */
export type PendingTarget = 'writing' | 'press'

/** 尚未接入宿主协议的条目操作 */
export type PendingNoteAction = Extract<NoteAction, 'open' | 'delete'>

/** 各占位入口的提示文案 */
const PENDING_NOTICE: Record<PendingTarget, string> = {
    writing: '写作管理将在后续版本接入',
    press: '公众号管理将在后续版本接入',
}

/** 笔记条目操作的提示文案（仅覆盖未接入协议的动作） */
const NOTE_NOTICE: Record<PendingNoteAction, string> = {
    open: '打开笔记将在后续版本接入',
    delete: '删除笔记将在后续版本接入',
}

export interface DashboardActionsState {
    pendingAction: string | null
    notice: string | null
    actionError: string | null
    createNote: () => Promise<CreatedNote | null>
    setPinned: (paths: string[], isPinned: boolean) => Promise<void>
    rebuild: () => Promise<void>
    clearCache: () => Promise<void>
    openSettings: () => Promise<void>
    showPending: (target: PendingTarget) => void
    showNotePending: (action: PendingNoteAction) => void
}

export function useDashboardActions(onCompleted: () => Promise<void>): DashboardActionsState {
    const [pendingAction, setPendingAction] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)
    const [actionError, setActionError] = useState<string | null>(null)

    const runAction = useCallback(
        async (action: string, method: string, payload?: unknown): Promise<void> => {
            setPendingAction(action)
            setActionError(null)
            try {
                await request(method, payload)
                await onCompleted()
            } catch (cause) {
                setActionError(cause instanceof Error ? cause.message : String(cause))
            } finally {
                setPendingAction(null)
            }
        },
        [onCompleted],
    )

    /** 新建空笔记：成功后刷新统计并回报提示，返回值供页面选中新条目 */
    const createNote = useCallback(async (): Promise<CreatedNote | null> => {
        setPendingAction('create')
        setActionError(null)
        try {
            const created = await request<CreatedNote>('note/create')
            await onCompleted()
            setNotice(`已创建笔记：${created.title}`)
            return created
        } catch (cause) {
            setActionError(cause instanceof Error ? cause.message : String(cause))
            return null
        } finally {
            setPendingAction(null)
        }
    }, [onCompleted])

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
        setNotice(PENDING_NOTICE[target])
        setActionError(null)
    }, [])

    const showNotePending = useCallback((action: PendingNoteAction): void => {
        setNotice(NOTE_NOTICE[action])
        setActionError(null)
    }, [])

    useEffect(() => {
        if (notice === null) {
            return
        }
        const timer = setTimeout(() => setNotice(null), NOTICE_TIMEOUT_MS)
        return (): void => clearTimeout(timer)
    }, [notice])

    return {
        pendingAction,
        notice,
        actionError,
        createNote,
        setPinned,
        rebuild,
        clearCache,
        openSettings,
        showPending,
        showNotePending,
    }
}
