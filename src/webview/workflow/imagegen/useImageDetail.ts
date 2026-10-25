/**
 * 图片详情钩子：按路径读取该图的出图参数快照（同名侧车），切换图片时重新读取。
 * 复用约定：协议 pressAi/getImageDetail，请求经 @shared/utils/bridge，失败经 toastError 提示；
 * 侧车是可选产物，读不到时宿主返回全 null，界面据此隐藏参数区。
 * 关键约束：path 为 null（面板关闭）时不发请求；结果与其来源路径绑定，
 * 迟到的回包不会被当成当前图片的详情；不做本地缓存，重复打开同一张图会重新读取。
 */
import { useCallback, useEffect, useState } from 'react'
import type { ImageDetailResult } from '@shared/types/imagegen'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'

export function useImageDetail(dirPath: string, path: string | null): ImageDetailResult | null {
    /** 结果与来源路径一起保存：展示前先比对路径，避免切图时串味 */
    const [loaded, setLoaded] = useState<{ path: string; detail: ImageDetailResult } | null>(null)

    const load = useCallback(
        async (target: string): Promise<void> => {
            try {
                const detail = await request<ImageDetailResult>('pressAi/getImageDetail', { dirPath, path: target })
                setLoaded({ path: target, detail })
            } catch (cause) {
                toastError(cause)
            }
        },
        [dirPath],
    )

    useEffect(() => {
        if (path === null) {
            return
        }
        void load(path)
    }, [load, path])

    return loaded !== null && loaded.path === path ? loaded.detail : null
}
