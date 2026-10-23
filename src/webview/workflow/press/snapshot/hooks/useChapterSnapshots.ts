/**
 * 章节快照取数与动作：列出有历史的章节、加载选中章节的版本时间线，并提供手动留版、恢复与删除。
 * 复用约定：请求统一走 webview bridge 的 request，错误提示走 utils.toastError；
 * 每次写操作后同时刷新章节清单与当前章时间线，界面始终以宿主返回为唯一事实来源。
 * 关键约束：切换作品或章节时丢弃在途响应，防止旧章节的版本串到新选择上。
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type {
    ChapterSnapshotCaptureResult,
    ChapterSnapshotDeleteResult,
    ChapterSnapshotEntry,
    ChapterSnapshotListResult,
    ChapterSnapshotRestoreResult,
    ChapterSnapshotSummary,
    ChapterSnapshotVersionsResult,
} from '@shared/types/press'
import { request } from '../../../../bridge'
import { toastError } from '../../../../utils'

/** 章节快照页所需的全部状态与动作 */
export interface ChapterSnapshotsState {
    chapters: ChapterSnapshotSummary[]
    versions: ChapterSnapshotEntry[]
    activeChapterPath: string | null
    isLoading: boolean
    isBusy: boolean
    selectChapter: (chapterPath: string | null) => void
    capture: (label?: string) => Promise<void>
    restore: (snapshotId: string) => Promise<void>
    remove: (snapshotId: string) => Promise<void>
}

/** 章节快照列表与动作：dirPath 为当前作品目录 */
export function useChapterSnapshots(dirPath: string): ChapterSnapshotsState {
    const [chapters, setChapters] = useState<ChapterSnapshotSummary[]>([])
    const [versions, setVersions] = useState<ChapterSnapshotEntry[]>([])
    const [activeChapterPath, setActiveChapterPath] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [isBusy, setIsBusy] = useState(false)
    /** 版本列表的刷新令牌：写操作后自增即可触发重新拉取，避免多处重复实现加载逻辑 */
    const [reloadToken, setReloadToken] = useState(0)

    useEffect(() => {
        let isCancelled = false
        setIsLoading(true)
        setActiveChapterPath(null)
        const load = async (): Promise<void> => {
            try {
                const result = await request<ChapterSnapshotListResult>('press/snapshot/chapter/list', { dirPath })
                if (!isCancelled) {
                    setChapters(result.chapters)
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

    useEffect(() => {
        if (activeChapterPath === null) {
            setVersions([])
            return
        }
        let isCancelled = false
        const load = async (): Promise<void> => {
            try {
                const result = await request<ChapterSnapshotVersionsResult>('press/snapshot/chapter/versions', {
                    dirPath,
                    chapterPath: activeChapterPath,
                })
                if (!isCancelled) {
                    setVersions(result.versions)
                }
            } catch (cause) {
                if (!isCancelled) {
                    toastError(cause)
                }
            }
        }
        void load()
        return (): void => {
            isCancelled = true
        }
    }, [dirPath, activeChapterPath, reloadToken])

    /** 写操作后统一刷新：章节清单取一次，版本列表靠令牌重取 */
    const refresh = useCallback(async (): Promise<void> => {
        const result = await request<ChapterSnapshotListResult>('press/snapshot/chapter/list', { dirPath })
        setChapters(result.chapters)
        setReloadToken((value) => value + 1)
    }, [dirPath])

    const capture = useCallback(
        async (label?: string): Promise<void> => {
            if (activeChapterPath === null) {
                return
            }
            setIsBusy(true)
            try {
                await request<ChapterSnapshotCaptureResult>('press/snapshot/chapter/capture', {
                    dirPath,
                    chapterPath: activeChapterPath,
                    label,
                })
                await refresh()
                toast.success('已保存一版章节快照')
            } catch (cause) {
                toastError(cause)
            } finally {
                setIsBusy(false)
            }
        },
        [activeChapterPath, dirPath, refresh],
    )

    const restore = useCallback(
        async (snapshotId: string): Promise<void> => {
            if (activeChapterPath === null) {
                return
            }
            setIsBusy(true)
            try {
                const result = await request<ChapterSnapshotRestoreResult>('press/snapshot/chapter/restore', {
                    dirPath,
                    chapterPath: activeChapterPath,
                    snapshotId,
                })
                await refresh()
                toast.success(result.restored ? '已恢复到所选版本' : '当前正文与所选版本一致，无需恢复')
            } catch (cause) {
                toastError(cause)
            } finally {
                setIsBusy(false)
            }
        },
        [activeChapterPath, dirPath, refresh],
    )

    const remove = useCallback(
        async (snapshotId: string): Promise<void> => {
            if (activeChapterPath === null) {
                return
            }
            setIsBusy(true)
            try {
                await request<ChapterSnapshotDeleteResult>('press/snapshot/chapter/delete', {
                    dirPath,
                    chapterPath: activeChapterPath,
                    snapshotId,
                })
                await refresh()
                toast.success('已删除该版本')
            } catch (cause) {
                toastError(cause)
            } finally {
                setIsBusy(false)
            }
        },
        [activeChapterPath, dirPath, refresh],
    )

    return {
        chapters,
        versions,
        activeChapterPath,
        isLoading,
        isBusy,
        selectChapter: setActiveChapterPath,
        capture,
        restore,
        remove,
    }
}
