/**
 * 数据统计：21 个官方统计视图与预设或自定义区间。
 * 复用约定：读 wechat/stats/query，维度、视图、区间与请求结构共用 shared 契约；
 * 同一次会话内按「账号 + 视图 + 区间 + 当日」缓存结果，刷新按钮强制绕过，降低 datacube 额度损耗。
 * 关键约束：切换视图时同步切到它所属的维度，避免出现维度与视图不匹配的请求；
 * 自定义区间由前端先校验日期顺序与跨度、宿主再校验一次；错误信息原样保留给界面展示具体原因。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
    WechatStatsDimension,
    WechatStatsQueryRequest,
    WechatStatsQueryResult,
    WechatStatsRange,
    WechatStatsView,
} from '@shared/types/wechat'
import { WECHAT_STATS_VIEW_META } from '@shared/types/wechat'
import { WECHAT_METHODS } from '@shared/types/wechatMethods'
import { request } from '@shared/utils/bridge'
import { toErrorText } from '@shared/utils/error'

/** 预设区间档位：与宿主校验保持一致 */
export type WechatStatsDays = 7 | 15 | 30

/** 每个维度进入时的默认视图 */
const DEFAULT_VIEWS: Readonly<Record<WechatStatsDimension, WechatStatsView>> = {
    users: 'userDaily',
    news: 'newsBiz',
    message: 'msgDaily',
    api: 'apiDaily',
}

export interface WechatStatsState {
    result: WechatStatsQueryResult | null
    dimension: WechatStatsDimension
    view: WechatStatsView
    range: WechatStatsRange
    status: 'loading' | 'ready' | 'error'
    error: string | null
    isRefreshing: boolean
    setDimension: (dimension: WechatStatsDimension) => void
    setView: (view: WechatStatsView) => void
    setRange: (range: WechatStatsRange) => void
    reload: () => Promise<void>
}

/** 取数器：默认走平台桥接，本地调试可注入示例数据函数 */
export type WechatStatsFetcher = (request: WechatStatsQueryRequest) => Promise<WechatStatsQueryResult>

/** 默认取数器：与平台协议通信，120 秒覆盖分时视图按天分段的最坏耗时 */
const fetchFromHost: WechatStatsFetcher = (payload) =>
    request<WechatStatsQueryResult>(WECHAT_METHODS.statsQuery, payload, 120_000)

/** 当日缓存项：跨天自动失效，避免把昨天的快照当成今天的结果 */
interface CachedStats {
    day: string
    result: WechatStatsQueryResult
}

export function useWechatStats(
    accountId: string,
    fetcher: WechatStatsFetcher = fetchFromHost,
    enabled = true,
): WechatStatsState {
    const [result, setResult] = useState<WechatStatsQueryResult | null>(null)
    const [dimension, setDimensionState] = useState<WechatStatsDimension>('users')
    const [view, setViewState] = useState<WechatStatsView>('userDaily')
    const [range, setRange] = useState<WechatStatsRange>({ kind: 'days', days: 7 })
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
    const [error, setError] = useState<string | null>(null)
    const [isRefreshing, setIsRefreshing] = useState(false)
    const cache = useRef<Map<string, CachedStats>>(new Map())
    const snapshot = useRef<WechatStatsQueryResult | null>(null)
    const snapshotKey = useRef('')

    const setDimension = useCallback((next: WechatStatsDimension): void => {
        setDimensionState(next)
        setViewState(DEFAULT_VIEWS[next])
    }, [])

    const setView = useCallback((next: WechatStatsView): void => {
        setViewState(next)
        setDimensionState(WECHAT_STATS_VIEW_META[next].dimension)
    }, [])

    const load = useCallback(
        async (force: boolean): Promise<void> => {
            const key = JSON.stringify({ accountId, view, range })
            const day = new Date().toISOString().slice(0, 10)
            const cached = cache.current.get(key)
            if (!force && cached?.day === day) {
                snapshot.current = cached.result
                snapshotKey.current = key
                setResult(cached.result)
                setStatus('ready')
                setError(null)
                return
            }

            // 同一查询的手动刷新保留旧快照；换视图或换区间语义已变，必须显式回到加载态
            if (snapshot.current !== null && snapshotKey.current === key) {
                setIsRefreshing(true)
            } else {
                snapshot.current = null
                setResult(null)
                setStatus('loading')
            }
            const payload: WechatStatsQueryRequest = { accountId, dimension, view, range }
            try {
                const next = await fetcher(payload)
                cache.current.set(key, { day, result: next })
                snapshot.current = next
                snapshotKey.current = key
                setResult(next)
                setStatus('ready')
                setError(null)
            } catch (cause) {
                cache.current.delete(key)
                snapshot.current = null
                snapshotKey.current = ''
                setResult(null)
                setStatus('error')
                setError(toErrorText(cause))
            } finally {
                setIsRefreshing(false)
            }
        },
        [accountId, dimension, view, range, fetcher],
    )

    useEffect(() => {
        if (enabled) {
            void load(false)
        }
    }, [load, enabled])

    const reload = useCallback(async (): Promise<void> => {
        await load(true)
    }, [load])

    return {
        result,
        dimension,
        view,
        range,
        status,
        error,
        isRefreshing,
        setDimension,
        setView,
        setRange,
        reload,
    }
}
