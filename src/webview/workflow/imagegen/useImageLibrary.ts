/**
 * 生图页数据钩子：按作品目录列举图片库，并提供单张/批量删除与刷新。
 * 复用约定：列举走 pressAi/listImageLibrary，删除走 pressAi/deleteImage，错误统一经 toastError 提示；
 * 返回结构直接使用宿主契约，不在前端二次归类。
 * 关键约束：磁盘是唯一事实来源——任何写操作后重新列举，不做乐观更新；
 * 批量删除逐张串行提交（宿主侧每次都会重扫目录），最后只列举一次并回传最新列表，
 * 供调用方按剩余图片修正角色封面指针；单张失败只提示，不中断整批。
 */
import { useCallback, useEffect, useState } from 'react'
import type {
    ImageDeleteResult,
    ImageLibraryResult,
    ImageMigrateResult,
    PressImageItem,
    PressImageKind,
} from '@shared/types/imagegen'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'

/** 空图库：首次加载前与作品无图时共用，避免各处重复造对象 */
const EMPTY_LIBRARY: ImageLibraryResult = {
    images: [],
    coverSelectedId: null,
    counts: { portrait: 0, photo: 0, orphan: 0 },
}

/** 批量删除的逐张结果：image 用于把回退值对回原图，result 为宿主回执 */
export interface ImageRemoval {
    image: PressImageItem
    result: ImageDeleteResult
}

/** 批量删除结果：images 为删除后重新列举得到的列表 */
export interface ImageBatchRemoval {
    removals: ImageRemoval[]
    images: PressImageItem[]
}

/** 批量删除进度回调：done 为已完成张数，total 为本批总数 */
export type ImageRemovalProgress = (done: number, total: number) => void

interface UseImageLibraryResult {
    images: PressImageItem[]
    coverSelectedId: string | null
    counts: Record<PressImageKind, number>
    isLoading: boolean
    reload: () => Promise<void>
    removeImage: (image: PressImageItem) => Promise<ImageDeleteResult | null>
    removeImages: (images: PressImageItem[], onProgress?: ImageRemovalProgress) => Promise<ImageBatchRemoval>
    migrate: () => Promise<ImageMigrateResult | null>
}

export function useImageLibrary(dirPath: string): UseImageLibraryResult {
    const [library, setLibrary] = useState<ImageLibraryResult>(EMPTY_LIBRARY)
    const [isLoading, setIsLoading] = useState(true)

    const reload = useCallback(async (): Promise<void> => {
        setIsLoading(true)
        try {
            const result = await request<ImageLibraryResult>('pressAi/listImageLibrary', { dirPath })
            setLibrary(result)
        } catch (cause) {
            toastError(cause)
        } finally {
            setIsLoading(false)
        }
    }, [dirPath])

    useEffect(() => {
        void reload()
    }, [reload])

    const removeImage = useCallback(
        async (image: PressImageItem): Promise<ImageDeleteResult | null> => {
            try {
                const result = await request<ImageDeleteResult>('pressAi/deleteImage', {
                    dirPath,
                    path: image.path,
                })
                await reload()
                return result
            } catch (cause) {
                toastError(cause)
                return null
            }
        },
        [dirPath, reload],
    )

    const removeImages = useCallback(
        async (targets: PressImageItem[], onProgress?: ImageRemovalProgress): Promise<ImageBatchRemoval> => {
            const removals: ImageRemoval[] = []
            let done = 0
            for (const image of targets) {
                try {
                    const result = await request<ImageDeleteResult>('pressAi/deleteImage', {
                        dirPath,
                        path: image.path,
                    })
                    removals.push({ image, result })
                } catch (cause) {
                    // 单张失败不中断整批：其余图片照常删除，失败原因逐条提示
                    toastError(cause)
                }
                done += 1
                onProgress?.(done, targets.length)
            }
            let images: PressImageItem[] = []
            try {
                const result = await request<ImageLibraryResult>('pressAi/listImageLibrary', { dirPath })
                setLibrary(result)
                images = result.images
            } catch (cause) {
                toastError(cause)
            }
            return { removals, images }
        },
        [dirPath],
    )

    const migrate = useCallback(async (): Promise<ImageMigrateResult | null> => {
        try {
            const result = await request<ImageMigrateResult>('pressAi/migrateImageDirs', { dirPath })
            await reload()
            return result
        } catch (cause) {
            toastError(cause)
            return null
        }
    }, [dirPath, reload])

    return {
        images: library.images,
        coverSelectedId: library.coverSelectedId,
        counts: library.counts,
        isLoading,
        reload,
        removeImage,
        removeImages,
        migrate,
    }
}
