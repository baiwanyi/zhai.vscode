/**
 * 快照页取数与动作：列举作品快照时间线，并提供手动留版、恢复与删除三个写操作。
 * 复用约定：请求统一走 webview bridge 的 request，错误提示走 utils.toastError；
 * 每个写操作完成后重新拉取列表，由宿主回传的时间线作为唯一事实来源，避免前端拼装出与磁盘不符的条目。
 * 关键约束：恢复与删除的二次确认由页面承担，本 hook 只负责执行；切换作品时丢弃在途响应，防止串到新作品。
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type {
    PressSnapshotCreateResult,
    PressSnapshotDeleteResult,
    PressSnapshotEntry,
    PressSnapshotFileKey,
    PressSnapshotListResult,
    PressSnapshotRestoreResult,
} from '@shared/types/press'
import { request } from '../../../../bridge'
import { toastError } from '../../../../utils'

/** 快照页所需的全部状态与动作 */
export interface PressSnapshotsState {
    snapshots: PressSnapshotEntry[]
    /** 首次加载中：只用于区分空态与加载态，不影响已有列表 */
    isLoading: boolean
    /** 写操作进行中：用于禁用按钮，避免重复提交 */
    isBusy: boolean
    createSnapshot: (label?: string) => Promise<void>
    restoreSnapshot: (snapshotId: string, files?: readonly PressSnapshotFileKey[]) => Promise<void>
    deleteSnapshot: (snapshotId: string) => Promise<void>
}

/** 快照列表与动作：dirPath 为当前作品目录，切换作品即重新取数 */
export function usePressSnapshots(dirPath: string): PressSnapshotsState {
    const [snapshots, setSnapshots] = useState<PressSnapshotEntry[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [isBusy, setIsBusy] = useState(false)

    const refresh = useCallback(async (): Promise<void> => {
        const result = await request<PressSnapshotListResult>('press/snapshot/list', { dirPath })
        setSnapshots(result.snapshots)
    }, [dirPath])

    useEffect(() => {
        let isCancelled = false
        setIsLoading(true)
        const load = async (): Promise<void> => {
            try {
                const result = await request<PressSnapshotListResult>('press/snapshot/list', { dirPath })
                if (!isCancelled) {
                    setSnapshots(result.snapshots)
                }
            } catch (cause) {
                if (!isCancelled) {
                    toastError(cause)
                }
            } finally {
                if (!isCancelled) {
                    setIsLoading(false)
                }
            }
        }
        void load()
        return (): void => {
            isCancelled = true
        }
    }, [dirPath])

    const createSnapshot = useCallback(
        async (label?: string): Promise<void> => {
            setIsBusy(true)
            try {
                await request<PressSnapshotCreateResult>('press/snapshot/create', { dirPath, label })
                await refresh()
                toast.success('已保存一版快照')
            } catch (cause) {
                toastError(cause)
            } finally {
                setIsBusy(false)
            }
        },
        [dirPath, refresh],
    )

    const restoreSnapshot = useCallback(
        async (snapshotId: string, files?: readonly PressSnapshotFileKey[]): Promise<void> => {
            setIsBusy(true)
            try {
                const result = await request<PressSnapshotRestoreResult>('press/snapshot/restore', {
                    dirPath,
                    snapshotId,
                    files,
                })
                await refresh()
                toast.success(
                    result.restored.length === 0 ? '当前内容与所选版本一致，无需恢复' : '已恢复到所选版本',
                )
            } catch (cause) {
                toastError(cause)
            } finally {
                setIsBusy(false)
            }
        },
        [dirPath, refresh],
    )

    const deleteSnapshot = useCallback(
        async (snapshotId: string): Promise<void> => {
            setIsBusy(true)
            try {
                await request<PressSnapshotDeleteResult>('press/snapshot/delete', { dirPath, snapshotId })
                await refresh()
                toast.success('已删除该版本')
            } catch (cause) {
                toastError(cause)
            } finally {
                setIsBusy(false)
            }
        },
        [dirPath, refresh],
    )

    return { snapshots, isLoading, isBusy, createSnapshot, restoreSnapshot, deleteSnapshot }
}
