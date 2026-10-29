/**
 * 媒体详情钩子：按媒体 id 读取出处、出图参数与全部引用，切换图片时重新读取。
 * 复用约定：协议 media/detail，请求经 @shared/utils/bridge，失败经 toastError 提示；
 * 引用列表由宿主按类型与时间排好序，前端只负责分组呈现，不重新排序。
 * 关键约束：id 为 null（面板关闭）时不发请求；结果与其来源 id 绑定，
 * 迟到的回包不会被当成当前图片的详情；不做本地缓存，重复打开同一张图会重新读取；
 * isLoading 只在当前图片尚无结果时为 true，读取失败同样落到结果态，不会永远转圈。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { MediaDetailResult } from '@shared/types/media'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'

/** 详情状态：detail 为 null 表示读取中或读取失败；isLoading 用于区分「等待回包」 */
export interface MediaDetailState {
    detail: MediaDetailResult | null
    isLoading: boolean
}

export function useImageDetail(id: string | null): MediaDetailState {
    /** 结果与来源 id 一起保存：展示前先比对 id，避免切图时串味 */
    const [loaded, setLoaded] = useState<{ id: string; detail: MediaDetailResult | null } | null>(null)
    /** 当前 id 的最新值：回包回来时用它判断是否已经切走 */
    const latestId = useRef<string | null>(null)

    const load = useCallback(async (target: string): Promise<void> => {
        try {
            const detail = await request<MediaDetailResult>('media/detail', { id: target })
            // 迟到回包直接丢弃而不是覆盖：否则会把新图的详情清空，面板退回骨架或空态
            if (latestId.current !== target) {
                return
            }
            setLoaded({ id: target, detail })
        } catch (cause) {
            // 失败也落到结果态：面板显示空态说明，而不是一直停在骨架屏
            if (latestId.current !== target) {
                return
            }
            setLoaded({ id: target, detail: null })
            toastError(cause)
        }
    }, [])

    useEffect(() => {
        latestId.current = id
        if (id === null) {
            return
        }
        void load(id)
    }, [load, id])

    const current = loaded !== null && loaded.id === id ? loaded : null
    return { detail: current === null ? null : current.detail, isLoading: id !== null && current === null }
}
