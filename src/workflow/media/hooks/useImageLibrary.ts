/**
 * 媒体页数据钩子：列举全库媒体，并提供单张/批量删除与刷新。
 * 复用约定：列举走 media/list（不带 month 即全量），删除走 media/delete 与 media/deleteBatch，
 * 错误统一经 toastError 提示；返回结构直接采用宿主契约，不在前端二次归类。
 * 关键约束：磁盘是唯一事实来源——任何写操作后重新列举，不做乐观更新；
 * 批量删除走一次 media/deleteBatch，宿主回执里带逐张结果与最新年月聚合，前端直接采用，
 * 不再逐张提交导致 N 次全量扫描；单张失败由宿主标记，这里汇总提示，不中断整批；
 * 刷新分两种：默认刷新会置 isLoading 让列表回到「正在读取」，静默刷新只换数据、不动加载态。
 */
import { useCallback, useEffect, useState } from 'react'
import type {
    MediaBatchDeleteResult,
    MediaDeleteResult,
    MediaItem,
    MediaListResult,
    MediaMonthCount,
} from '@shared/types/media'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'

/** 空图库：首次加载前与仓库为空时共用 */
const EMPTY_LIBRARY: MediaListResult = { items: [], months: [], total: 0 }

/** 批量删除的逐张结果：item 用于把回执对回原图，removed 表示该张是否真的删掉 */
export interface MediaRemoval {
    item: MediaItem
    removed: boolean
}

/** 批量删除结果：items 为删除后重新聚合的列表 */
export interface MediaBatchRemoval {
    removals: MediaRemoval[]
    items: MediaItem[]
}

/** 刷新选项：silent 为 true 时不切换 isLoading，用于后台补图 */
interface ReloadOptions {
    silent?: boolean
}

interface UseMediaLibraryResult {
    items: MediaItem[]
    months: MediaMonthCount[]
    total: number
    isLoading: boolean
    reload: (options?: ReloadOptions) => Promise<void>
    removeMedia: (item: MediaItem) => Promise<MediaDeleteResult | null>
    removeMedias: (items: MediaItem[]) => Promise<MediaBatchRemoval>
}

export function useImageLibrary(): UseMediaLibraryResult {
    const [library, setLibrary] = useState<MediaListResult>(EMPTY_LIBRARY)
    const [isLoading, setIsLoading] = useState(true)
    /** 当前列表快照：失败分支回退时直接复用，避免把 state 读进 useCallback 依赖造成额外重建 */
    const currentItems = library.items

    const reload = useCallback(async (options?: ReloadOptions): Promise<void> => {
        const isSilent = options?.silent === true
        if (!isSilent) {
            setIsLoading(true)
        }
        try {
            const result = await request<MediaListResult>('media/list', {})
            setLibrary(result)
        } catch (cause) {
            toastError(cause)
        } finally {
            if (!isSilent) {
                setIsLoading(false)
            }
        }
    }, [])

    useEffect(() => {
        void reload()
    }, [reload])

    const removeMedia = useCallback(
        async (item: MediaItem): Promise<MediaDeleteResult | null> => {
            try {
                const result = await request<MediaDeleteResult>('media/delete', { id: item.id })
                await reload()
                return result
            } catch (cause) {
                toastError(cause)
                return null
            }
        },
        [reload],
    )

    /**
     * 批量删除：一次请求交给宿主完成，宿主回执里带逐张结果，前端按回执汇总提示后重新列举。
     * 单张失败由宿主在回执里标记，这里汇总提示，不中断其余图片；
     * 列举不能省——宿主的批量回执只带年月聚合，不带条目，前端不做乐观删减。
     */
    const removeMedias = useCallback(
        async (targets: MediaItem[]): Promise<MediaBatchRemoval> => {
            if (targets.length === 0) {
                return { removals: [], items: currentItems }
            }
            try {
                const result = await request<MediaBatchDeleteResult>('media/deleteBatch', {
                    ids: targets.map((item) => item.id),
                })
                const removedIds = new Set(result.removals.filter((entry) => entry.removed).map((entry) => entry.id))
                const failed = targets.filter((item) => !removedIds.has(item.id)).length
                if (failed > 0) {
                    toastError(new Error(`${failed} 张图片删除失败，请重试`))
                }
                await reload({ silent: true })
                return {
                    removals: targets.map((item) => ({ item, removed: removedIds.has(item.id) })),
                    items: [],
                }
            } catch (cause) {
                toastError(cause)
                return { removals: [], items: currentItems }
            }
        },
        [currentItems, reload],
    )

    return {
        items: library.items,
        months: library.months,
        total: library.total,
        isLoading,
        reload,
        removeMedia,
        removeMedias,
    }
}
