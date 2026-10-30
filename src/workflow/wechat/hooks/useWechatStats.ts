/**
 * 数据统计：用户增长概览（新增 / 取消 / 净增 / 累计）。
 * 复用约定：读 wechat/stats/overview，区间只开放 7 / 15 / 30 三档（宿主同样只接受这三个值）；
 * 失败信息原样保留给界面，便于把「需要认证主体」这类权限原因直接展示出来。
 * 关键约束：切换区间即重新取数，不做多区间缓存——datacube 有日额度，缓存会让用户以为切换很快，
 * 反而掩盖额度耗尽；数据为空时状态仍是 ready，由界面区分「没有数据」与「读取失败」。
 */
import { useCallback, useEffect, useState } from 'react'
import type { WechatStatsRequest, WechatStatsResult } from '@shared/types/wechat'
import { request } from '@shared/utils/bridge'
import { toErrorText } from '@shared/utils/error'

/** 区间档位：与宿主侧校验保持一致 */
export type WechatStatsDays = 7 | 15 | 30

export interface WechatStatsState {
    stats: WechatStatsResult | null
    days: WechatStatsDays
    status: 'loading' | 'ready' | 'error'
    error: string | null
    setDays: (days: WechatStatsDays) => void
    reload: () => Promise<void>
}

export function useWechatStats(accountId: string): WechatStatsState {
    const [stats, setStats] = useState<WechatStatsResult | null>(null)
    const [days, setDays] = useState<WechatStatsDays>(7)
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
    const [error, setError] = useState<string | null>(null)

    const reload = useCallback(async (): Promise<void> => {
        setStatus('loading')
        const payload: WechatStatsRequest = { accountId, days }
        try {
            const result = await request<WechatStatsResult>('wechat/stats/overview', payload, 60_000)
            setStats(result)
            setStatus('ready')
            setError(null)
        } catch (cause) {
            setStats(null)
            setStatus('error')
            setError(toErrorText(cause))
        }
    }, [accountId, days])

    useEffect(() => {
        void reload()
    }, [reload])

    return { stats, days, status, error, setDays, reload }
}
