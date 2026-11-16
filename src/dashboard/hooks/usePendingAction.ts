/**
 * 在途动作跟踪：记录「哪个动作正在运行」，供界面禁用入口与确认弹窗的提交态复用。
 * 复用 useState + 计数 ref，不引入额外状态机。
 * 关键约束：pendingAction 只表示最后开始的动作，仅用于整体忙碌态；判断某个动作是否在途必须走 isPending，
 * 否则并发（如删除进行中又置顶）会让弹窗的提交态提前失效；
 * 计数归零才清空 pendingAction，避免先完成者提前解锁界面；
 * 子动作 Hook 只拿到 begin/end，不暴露查询与集合，避免各处自造忙碌态。
 */
import { useCallback, useRef, useState } from 'react'

/** 在途动作标识：页面据它判断具体哪个操作正在进行（如确认弹窗的 isSubmitting） */
export type PendingAction =
    | 'create'
    | 'delete'
    | 'notebook-create'
    | 'notebook-delete'
    | 'notebook-open'
    | 'notebook-pin'
    | 'notebook-rename'
    | 'notebook-sort'
    | 'pin'
    | 'trash-clear'
    | 'trash-purge'
    | 'trash-restore'

/** 子动作 Hook 需要的在途入口：只有开始与结束 */
export interface PendingScope {
    begin: (action: PendingAction) => void
    end: (action: PendingAction) => void
}

export interface PendingTracker extends PendingScope {
    /** 最后开始的在途动作：null 表示没有动作在途 */
    pendingAction: PendingAction | null
    /** 指定动作是否在途：并发场景下的准确判定 */
    isPending: (action: PendingAction) => boolean
}

export function usePendingAction(): PendingTracker {
    const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
    /** 在途动作集合：并发时用于准确回答「某动作是否仍在跑」 */
    const [pendingActions, setPendingActions] = useState<ReadonlySet<PendingAction>>(() => new Set())
    /** 在途计数：全部落定才清空 pendingAction，避免先完成者提前解锁界面 */
    const pendingCountRef = useRef(0)

    const begin = useCallback((action: PendingAction): void => {
        pendingCountRef.current += 1
        setPendingAction(action)
        setPendingActions((previous) => new Set(previous).add(action))
    }, [])

    const end = useCallback((action: PendingAction): void => {
        pendingCountRef.current = Math.max(0, pendingCountRef.current - 1)
        setPendingActions((previous) => {
            if (!previous.has(action)) {
                return previous
            }
            const next = new Set(previous)
            next.delete(action)
            return next
        })
        if (pendingCountRef.current === 0) {
            setPendingAction(null)
        }
    }, [])

    const isPending = useCallback((action: PendingAction): boolean => pendingActions.has(action), [pendingActions])

    return { pendingAction, isPending, begin, end }
}
