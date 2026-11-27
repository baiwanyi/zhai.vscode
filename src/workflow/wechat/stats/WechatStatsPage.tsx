/**
 * 统计页装配层：连接取数 hook、页头、筛选区与结果区。
 * 切维度重置区间与指标，切视图只重置指标；筛选区以 view 为 key 重挂载。
 */
import { useMemo, useState } from 'react'
import type { WechatAccountSummary, WechatStatsDimension, WechatStatsView } from '@shared/types/wechat'
import { WECHAT_STATS_VIEW_META } from '@shared/types/wechat'
import { AppContent, AppPage } from '@webview/components/AppPage'
import { StatsFilters } from './layout/StatsFilters'
import { StatsHeader } from './layout/StatsHeader'
import { StatsResultView } from './layout/StatsResultView'
import { readStatsViewOptions } from './utils/statsViewOptions'
import type { JSX } from 'react'
import { useWechatStats, type WechatStatsFetcher, type WechatStatsState } from '../hooks/useWechatStats'

interface WechatStatsPageProps {
    account: WechatAccountSummary
    /** 自定义取数器，默认走平台协议 */
    fetcher?: WechatStatsFetcher
    /** 外部取数状态，传入后不再调用 hook */
    statsState?: WechatStatsState
}

export function WechatStatsPage({ account, fetcher, statsState }: WechatStatsPageProps): JSX.Element {
    const internal = useWechatStats(account.id, fetcher, statsState === undefined)
    const state = statsState ?? internal
    const { result, dimension, view, range, status, error, isRefreshing, setDimension, setView, setRange, reload } =
        state
    const [activeMetricKey, setActiveMetricKey] = useState('')

    const meta = WECHAT_STATS_VIEW_META[view]
    const viewOptions = useMemo(() => readStatsViewOptions(dimension), [dimension])

    const onViewChange = (next: WechatStatsView): void => {
        setView(next)
        setActiveMetricKey('')
    }

    const onDimensionChange = (next: WechatStatsDimension): void => {
        setDimension(next)
        setRange({ kind: 'days', days: 7 })
        setActiveMetricKey('')
    }

    return (
        <AppPage>
            <StatsHeader
                accountName={account.name}
                dimension={dimension}
                meta={meta}
                result={result}
                isRefreshing={isRefreshing}
                onRefresh={() => void reload()}
                onDimensionChange={onDimensionChange}
            />
            <AppContent isScrollable>
                <StatsFilters
                    key={view}
                    view={view}
                    viewOptions={viewOptions}
                    meta={meta}
                    range={range}
                    onViewChange={onViewChange}
                    onRangeChange={setRange}
                />
                <StatsResultView
                    status={status}
                    error={error}
                    result={result}
                    emptyDescription={`${meta.label}自 ${meta.since} 起记录，按自然日结算，次日更新。`}
                    deprecatedNotice={meta.deprecated}
                    activeMetricKey={activeMetricKey}
                    onSelectMetric={setActiveMetricKey}
                    onRetry={() => void reload()}
                />
            </AppContent>
        </AppPage>
    )
}
