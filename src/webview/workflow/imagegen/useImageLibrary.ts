/**
 * 生图页数据钩子：按作品目录列举图片库，并提供删除与刷新。
 * 复用约定：列举走 pressAi/listImageLibrary，删除走 pressAi/deleteImage，错误统一经 toastError 提示；
 * 返回结构直接使用宿主契约，不在前端二次归类。
 * 关键约束：磁盘是唯一事实来源——任何写操作后重新列举，不做乐观更新；
 * 删除结果携带作品封面回退值，调用方据此同步本地状态，避免出现已删图仍带封面徽标。
 */
import { useCallback, useEffect, useState } from 'react'
import type { ImageDeleteResult, ImageLibraryResult, PressImageItem, PressImageKind } from '@shared/types/imagegen'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'

/** 空图库：首次加载前与作品无图时共用，避免各处重复造对象 */
const EMPTY_LIBRARY: ImageLibraryResult = {
    images: [],
    coverSelectedId: null,
    counts: { portrait: 0, photo: 0, orphan: 0 },
}

interface UseImageLibraryResult {
    images: PressImageItem[]
    coverSelectedId: string | null
    counts: Record<PressImageKind, number>
    isLoading: boolean
    reload: () => Promise<void>
    removeImage: (image: PressImageItem) => Promise<ImageDeleteResult | null>
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

    return {
        images: library.images,
        coverSelectedId: library.coverSelectedId,
        counts: library.counts,
        isLoading,
        reload,
        removeImage,
    }
}
