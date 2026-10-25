/**
 * 生图页数据钩子：按作品目录列举图片库，并提供单张/批量删除与刷新。
 * 复用约定：列举走 pressAi/listImageLibrary，删除走 pressAi/deleteImage，错误统一经 toastError 提示；
 * 返回结构直接使用宿主契约，不在前端二次归类。
 * 关键约束：磁盘是唯一事实来源——任何写操作后重新列举，不做乐观更新；
 * 批量删除走一次 pressAi/deleteImages，宿主删除后只重扫一次并回传新图库，前端直接采用，
 * 不再逐张提交导致 N 次全量扫描；单张失败由宿主标记，这里汇总提示，不中断整批。
 */
import { useCallback, useEffect, useState } from 'react'
import type {
    ImageBatchDeleteResult,
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

/** 批量删除的逐张结果：image 用于把回执对回原图，removed 表示该张是否真的删掉 */
export interface ImageRemoval {
    image: PressImageItem
    removed: boolean
}

/** 批量删除结果：images 为宿主回传的删除后列表 */
export interface ImageBatchRemoval {
    removals: ImageRemoval[]
    images: PressImageItem[]
}

interface UseImageLibraryResult {
    images: PressImageItem[]
    coverSelectedId: string | null
    counts: Record<PressImageKind, number>
    isLoading: boolean
    reload: () => Promise<void>
    removeImage: (image: PressImageItem) => Promise<ImageDeleteResult | null>
    removeImages: (images: PressImageItem[]) => Promise<ImageBatchRemoval>
    migrate: () => Promise<ImageMigrateResult | null>
}

export function useImageLibrary(dirPath: string): UseImageLibraryResult {
    const [library, setLibrary] = useState<ImageLibraryResult>(EMPTY_LIBRARY)
    const [isLoading, setIsLoading] = useState(true)
    /** 当前列表快照：失败分支回退时直接复用，避免把 state 读进 useCallback 依赖造成额外重建 */
    const currentImages = library.images

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

    /**
     * 批量删除：一次请求交给宿主完成，宿主回传删除后的完整图库，前端直接采用、不再二次列举。
     * 单张失败由宿主在回执里标记，这里汇总提示，不中断其余图片。
     */
    const removeImages = useCallback(
        async (targets: PressImageItem[]): Promise<ImageBatchRemoval> => {
            if (targets.length === 0) {
                return { removals: [], images: currentImages }
            }
            try {
                const result = await request<ImageBatchDeleteResult>('pressAi/deleteImages', {
                    dirPath,
                    paths: targets.map((image) => image.path),
                })
                setLibrary(result.library)
                const removedPaths = new Set(result.removals.filter((item) => item.removed).map((item) => item.path))
                const failed = targets.filter((image) => !removedPaths.has(image.path)).length
                if (failed > 0) {
                    toastError(new Error(`${failed} 张图片删除失败，请重试`))
                }
                return {
                    removals: targets.map((image) => ({ image, removed: removedPaths.has(image.path) })),
                    images: result.library.images,
                }
            } catch (cause) {
                toastError(cause)
                return { removals: [], images: currentImages }
            }
        },
        [dirPath, currentImages],
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
