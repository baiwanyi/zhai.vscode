/**
 * 标注总览统计：页头计数与「失效 N」的单一数据源。
 * 复用约定：协议走 bridge 的 annotation/stats，类型取 @shared/types/editor；
 * 计数是全量口径、不随筛选变化，故只在挂载与写操作后拉取，翻页与改筛选都不触发。
 * 关键约束：请求带序号，旧响应后到时直接丢弃，避免并发刷新把页头计数改回旧值；
 * 卸载后不再 setState；失败置 null 让页头整行不渲染，不阻断列表展示。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AnnotationStats } from '@shared/types/editor'
import { request } from '@shared/utils/bridge'

export interface UseAnnotationStatsResult {
    stats: AnnotationStats | null
    /** 显式刷新：删除、置失效等写操作后调用 */
    refresh: () => Promise<void>
}

export function useAnnotationStats(): UseAnnotationStatsResult {
    const [stats, setStats] = useState<AnnotationStats | null>(null)
    /** 请求序号：并发刷新只认最后一次，旧响应后到直接丢弃 */
    const requestSeqRef = useRef(0)
    /** 挂载标记：卸载后不再 setState */
    const isMountedRef = useRef(true)

    useEffect(() => {
        isMountedRef.current = true
        return (): void => {
            isMountedRef.current = false
        }
    }, [])

    const refresh = useCallback(async (): Promise<void> => {
        requestSeqRef.current += 1
        const seq = requestSeqRef.current
        try {
            const next = await request<AnnotationStats>('annotation/stats', {})
            if (!isMountedRef.current || seq !== requestSeqRef.current) {
                return
            }
            setStats(next)
        } catch {
            if (!isMountedRef.current || seq !== requestSeqRef.current) {
                return
            }
            setStats(null)
        }
    }, [])

    // 挂载拉一次：计数与列表筛选无关，之后只由写操作显式触发
    useEffect(() => {
        void refresh()
    }, [refresh])

    return { stats, refresh }
}
