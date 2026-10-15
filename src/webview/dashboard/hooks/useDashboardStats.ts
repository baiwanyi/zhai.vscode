/**
 * 仪表盘统计加载：拉取 dashboard/stats 快照并暴露加载状态，重建期间轮询直至宿主收敛。
 * 复用 ../bridge 的请求与状态订阅：宿主经 index 通道推送索引变更时立即重拉，使列表跟随文件编辑。
 * 关键约束：轮询仅在 isRebuilding 为真时存在，卸载或收敛后立即清理解除定时器；
 * 状态订阅须在卸载时解除，避免页面重挂载后重复触发刷新。
 */
import { useCallback, useEffect, useState } from 'react'
import type { DashboardStats } from '@/shared/types/dashboard'
import { onState, request } from '../../bridge'

/** 重建期间轮询间隔，使按钮态与统计随宿主进度收敛 */
const POLL_INTERVAL_MS = 1500

/** 统计加载状态：ready 表示已拿到快照，error 表示最近一次拉取失败 */
export type StatsStatus = 'loading' | 'ready' | 'error'

export interface DashboardStatsState {
    stats: DashboardStats | null
    status: StatsStatus
    error: string | null
    reload: () => Promise<void>
}

export function useDashboardStats(): DashboardStatsState {
    const [stats, setStats] = useState<DashboardStats | null>(null)
    const [status, setStatus] = useState<StatsStatus>('loading')
    const [error, setError] = useState<string | null>(null)

    const reload = useCallback(async (): Promise<void> => {
        try {
            const next = await request<DashboardStats>('dashboard/stats')
            setStats(next)
            setStatus('ready')
            setError(null)
        } catch (cause) {
            setStatus('error')
            setError(cause instanceof Error ? cause.message : String(cause))
        }
    }, [])

    useEffect(() => {
        void reload()
    }, [reload])

    // 索引变更（外部编辑保存笔记等）由宿主经 index 通道广播，收到即重拉，避免列表与磁盘内容脱节
    useEffect(() => {
        return onState((message) => {
            if (message.channel === 'index') {
                void reload()
            }
        })
    }, [reload])

    const isRebuilding = stats?.isRebuilding === true
    useEffect(() => {
        if (!isRebuilding) {
            return
        }
        const timer = setInterval(() => void reload(), POLL_INTERVAL_MS)
        return (): void => clearInterval(timer)
    }, [isRebuilding, reload])

    return { stats, status, error, reload }
}
