/**
 * 图片详情钩子：按路径读取该图的出图参数快照（同名侧车），切换图片时重新读取。
 * 复用约定：协议 pressAi/getImageDetail，请求经 @shared/utils/bridge，失败经 toastError 提示；
 * 侧车是可选产物，读不到时宿主返回全 null，界面据此隐藏参数区。
 * 关键约束：path 为 null（面板关闭）时不发请求；结果与其来源路径绑定，
 * 迟到的回包不会被当成当前图片的详情；不做本地缓存，重复打开同一张图会重新读取；
 * isLoading 只在当前图片尚无结果时为 true，读取失败同样落到结果态（detail 为 null），不会永远转圈。
 */
import { useCallback, useEffect, useState } from 'react'
import type { ImageDetailResult } from '@shared/types/imagegen'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'

/** 详情状态：detail 为 null 表示读取中或读取失败；isLoading 用于区分「等待回包」 */
export interface ImageDetailState {
    detail: ImageDetailResult | null
    isLoading: boolean
}

export function useImageDetail(dirPath: string, path: string | null): ImageDetailState {
    /** 结果与来源路径一起保存：展示前先比对路径，避免切图时串味 */
    const [loaded, setLoaded] = useState<{ path: string; detail: ImageDetailResult | null } | null>(null)

    const load = useCallback(
        async (target: string): Promise<void> => {
            try {
                const detail = await request<ImageDetailResult>('pressAi/getImageDetail', { dirPath, path: target })
                setLoaded({ path: target, detail })
            } catch (cause) {
                // 失败也落到结果态：面板显示空态说明，而不是一直停在骨架屏
                setLoaded({ path: target, detail: null })
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

    const current = loaded !== null && loaded.path === path ? loaded : null
    return { detail: current === null ? null : current.detail, isLoading: path !== null && current === null }
}
