/**
 * 回收站动作：恢复、彻底清除选中项与清空。
 * 复用 ../core/actionRunner 的请求与批量结果提示，在途态由调用方注入。
 * 关键约束：恢复会新增笔记、清除会减少条目，三者成功后都刷新一次快照让列表与计数立刻收敛；
 * 成功与失败各自一条提示（成功条数 + 首条失败原因），没有任何结果时不发提示；
 * 彻底清除不可恢复，二次确认由页面承担，本层只负责提交与提示。
 */
import { useCallback } from 'react'
import type { TrashClearResult, TrashPurgeResult, TrashRestoreResult } from '@shared/types/trash'
import type { PendingScope } from './usePendingAction'
import { callHostRequest, notifyBatchOutcome } from '../core/actionRunner'

export interface TrashActionsOptions {
    tracker: PendingScope
    /** 动作落定后的快照刷新：成功才调用 */
    onCompleted: () => Promise<void>
}

export interface TrashActionsState {
    restoreTrash: (ids: string[]) => Promise<TrashRestoreResult | null>
    purgeTrash: (ids: string[]) => Promise<TrashPurgeResult | null>
    clearTrash: () => Promise<TrashClearResult | null>
}

export function useTrashActions(options: TrashActionsOptions): TrashActionsState {
    const { onCompleted, tracker } = options

    /** 恢复回收站条目：宿主按原笔记本还原并重新索引，恢复结果汇总后提示 */
    const restoreTrash = useCallback(
        async (ids: string[]): Promise<TrashRestoreResult | null> => {
            tracker.begin('trash-restore')
            try {
                const result = await callHostRequest<TrashRestoreResult>('trash/restore', { ids })
                if (result === null) {
                    return null
                }
                await onCompleted()
                notifyBatchOutcome({
                    successText: (count) => `已恢复 ${String(count)} 篇笔记`,
                    count: result.restored.length,
                    failures: result.failures,
                    failureAction: '恢复',
                })
                return result
            } finally {
                tracker.end('trash-restore')
            }
        },
        [onCompleted, tracker],
    )

    /** 彻底清除回收站条目：不可恢复，结果汇总后提示 */
    const purgeTrash = useCallback(
        async (ids: string[]): Promise<TrashPurgeResult | null> => {
            tracker.begin('trash-purge')
            try {
                const result = await callHostRequest<TrashPurgeResult>('trash/purge', { ids })
                if (result === null) {
                    return null
                }
                await onCompleted()
                notifyBatchOutcome({
                    successText: (count) => `已彻底删除 ${String(count)} 项`,
                    count: result.purgedIds.length,
                    failures: result.failures,
                    failureAction: '清除',
                })
                return result
            } finally {
                tracker.end('trash-purge')
            }
        },
        [onCompleted, tracker],
    )

    /** 清空回收站：逐条彻底删除，结果汇总后提示 */
    const clearTrash = useCallback(async (): Promise<TrashClearResult | null> => {
        tracker.begin('trash-clear')
        try {
            const result = await callHostRequest<TrashClearResult>('trash/clear')
            if (result === null) {
                return null
            }
            await onCompleted()
            notifyBatchOutcome({
                successText: (count) => `已清空回收站（${String(count)} 项）`,
                count: result.purgedCount,
                failures: result.failures,
                failureAction: '清除',
            })
            return result
        } finally {
            tracker.end('trash-clear')
        }
    }, [onCompleted, tracker])

    return { restoreTrash, purgeTrash, clearTrash }
}
