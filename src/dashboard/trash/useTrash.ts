/**
 * 回收站数据：拉取 trash/list 并暴露加载状态，供回收站页呈现列表、空态与失败态。
 * 复用 @shared/utils/bridge 的请求封装与 @shared/utils/error 的错误归一。
 * 关键约束：恢复与清除由页面动作完成后调用 reload 主动刷新，不订阅宿主广播（回收站不在索引库内）；
 * 加载失败保留上一次成功结果，避免一次抖动把已列出的条目清空。
 */
import { useCallback, useEffect, useState } from 'react'
import type { TrashItem, TrashListResult } from '@shared/types/trash'
import { request } from '@shared/utils/bridge'
import { toErrorText } from '@shared/utils/error'

/** 回收站加载状态：ready 表示已拿到快照，error 表示最近一次拉取失败 */
export type TrashStatus = 'loading' | 'ready' | 'error'

export interface TrashState {
    items: TrashItem[]
    status: TrashStatus
    error: string | null
    reload: () => Promise<void>
}

export function useTrash(): TrashState {
    const [items, setItems] = useState<TrashItem[]>([])
    const [status, setStatus] = useState<TrashStatus>('loading')
    const [error, setError] = useState<string | null>(null)

    const reload = useCallback(async (): Promise<void> => {
        try {
            const result = await request<TrashListResult>('trash/list')
            setItems(result.items)
            setStatus('ready')
            setError(null)
        } catch (cause) {
            setStatus('error')
            setError(toErrorText(cause))
        }
    }, [])

    useEffect(() => {
        void reload()
    }, [reload])

    return { items, status, error, reload }
}
