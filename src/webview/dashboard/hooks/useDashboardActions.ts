/**
 * 仪表盘宿主动作：索引重建、缓存清理、打开设置，以及尚未接入协议的入口占位反馈。
 * 复用 ../bridge 走宿主白名单协议；错误与提示分列，避免占位说明覆盖真实失败信息。
 * 关键约束：占位提示定时自动消失，定时器随卸载清理；动作进行中记录 pendingAction 阻止重复提交。
 */
import { useCallback, useEffect, useState } from 'react'
import type { NoteAction } from '@/shared/types/dashboard'
import { request } from '../../bridge'

/** 占位提示的保留时长 */
const NOTICE_TIMEOUT_MS = 4000

/** 尚未接入宿主协议的入口 */
export type PendingTarget = 'add' | 'writing' | 'press'

/** 各占位入口的提示文案 */
const PENDING_NOTICE: Record<PendingTarget, string> = {
    add: '新建笔记将在后续版本接入',
    writing: '写作管理将在后续版本接入',
    press: '公众号管理将在后续版本接入',
}

/** 笔记条目操作的提示文案 */
const NOTE_NOTICE: Record<NoteAction, string> = {
    open: '打开笔记将在后续版本接入',
    delete: '删除笔记将在后续版本接入',
}

export interface DashboardActionsState {
    pendingAction: string | null
    notice: string | null
    actionError: string | null
    rebuild: () => Promise<void>
    clearCache: () => Promise<void>
    openSettings: () => Promise<void>
    showPending: (target: PendingTarget) => void
    showNotePending: (action: NoteAction) => void
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

    const showNotePending = useCallback((action: NoteAction): void => {
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

    return { pendingAction, notice, actionError, rebuild, clearCache, openSettings, showPending, showNotePending }
}
