/**
 * 单文件快照取数与动作：加载当前文档的版本时间线，并提供手动留版、恢复与删除。
 * 复用约定：请求统一走 @shared/utils/bridge 的 request，错误提示走 @shared/utils/error 的 toastError；
 * 每次写操作后重新拉取时间线，界面始终以宿主返回为唯一事实来源。
 * 关键约束：docPath 变化时丢弃在途响应，防止上一份文档的版本串到当前文档上。
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type {
    DocSnapshotCaptureResult,
    DocSnapshotDeleteResult,
    DocSnapshotEntry,
    DocSnapshotListResult,
    DocSnapshotRestoreResult,
} from '@shared/types/snapshot'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'

/** 单文件快照页所需的全部状态与动作 */
export interface DocSnapshotsState {
    versions: DocSnapshotEntry[]
    isLoading: boolean
    isBusy: boolean
    capture: (label?: string) => Promise<void>
    restore: (snapshotId: string) => Promise<void>
    remove: (snapshotId: string) => Promise<void>
}

/** 单文档时间线：docPath 为存储根相对的文档路径，与宿主下发的路由事实同源 */
export function useDocSnapshots(docPath: string): DocSnapshotsState {
    const [versions, setVersions] = useState<DocSnapshotEntry[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [isBusy, setIsBusy] = useState(false)
    /** 时间线刷新令牌：写操作后自增即可触发重新拉取，避免多处重复实现加载逻辑 */
    const [reloadToken, setReloadToken] = useState(0)

    useEffect(() => {
        let isCancelled = false
        setIsLoading(true)
        const load = async (): Promise<void> => {
            try {
                const result = await request<DocSnapshotListResult>('press/snapshot/doc/list', { docPath })
                if (!isCancelled) {
                    setVersions(result.versions)
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
    }, [docPath, reloadToken])

    const capture = useCallback(
        async (label?: string): Promise<void> => {
            setIsBusy(true)
            try {
                await request<DocSnapshotCaptureResult>('press/snapshot/doc/capture', { docPath, label })
                setReloadToken((value) => value + 1)
                toast.success('已保存一版文档快照')
            } catch (cause) {
                toastError(cause)
            } finally {
                setIsBusy(false)
            }
        },
        [docPath],
    )

    const restore = useCallback(
        async (snapshotId: string): Promise<void> => {
            setIsBusy(true)
            try {
                const result = await request<DocSnapshotRestoreResult>('press/snapshot/doc/restore', {
                    docPath,
                    snapshotId,
                })
                setReloadToken((value) => value + 1)
                toast.success(result.restored ? '已恢复到所选版本' : '当前正文与所选版本一致，无需恢复')
            } catch (cause) {
                toastError(cause)
            } finally {
                setIsBusy(false)
            }
        },
        [docPath],
    )

    const remove = useCallback(
        async (snapshotId: string): Promise<void> => {
            setIsBusy(true)
            try {
                await request<DocSnapshotDeleteResult>('press/snapshot/doc/delete', { docPath, snapshotId })
                setReloadToken((value) => value + 1)
                toast.success('已删除该版本')
            } catch (cause) {
                toastError(cause)
            } finally {
                setIsBusy(false)
            }
        },
        [docPath],
    )

    return { versions, isLoading, isBusy, capture, restore, remove }
}
