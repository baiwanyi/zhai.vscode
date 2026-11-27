/**
 * 统计页页头：标题、数据说明、刷新、账号摘要与维度切换。
 * AppDescription 合并延迟状态与跨度说明；摘要日期取结果快照，加载期显示破折号。
 */
import { RefreshCw } from 'lucide-react'
import type { WechatStatsDimension, WechatStatsQueryResult, WechatStatsViewMeta } from '@shared/types/wechat'
import { WECHAT_STATS_DIMENSIONS, WECHAT_STATS_DIMENSION_LABELS } from '@shared/types/wechat'
import { AppAction, AppDescription, AppHeader, AppMenu, AppTitle } from '@webview/components/AppPage'
import { AppSummary } from '@webview/components/AppSummary'
import { Button } from '@webview/components/Button'
import { SegmentedRail } from '@webview/components/SegmentedRail'
import type { JSX } from 'react'

/** 维度选项：固定配置提到模块级，避免每次渲染重建数组 */
const DIMENSION_OPTIONS: readonly { value: WechatStatsDimension; label: string }[] = WECHAT_STATS_DIMENSIONS.map(
    (value) => ({ value, label: WECHAT_STATS_DIMENSION_LABELS[value] }),
)

interface StatsHeaderProps {
    accountName: string
    dimension: WechatStatsDimension
    meta: WechatStatsViewMeta
    result: WechatStatsQueryResult | null
    isRefreshing: boolean
    onRefresh: () => void
    onDimensionChange: (dimension: WechatStatsDimension) => void
}

export function StatsHeader({
    accountName,
    dimension,
    meta,
    result,
    isRefreshing,
    onRefresh,
    onDimensionChange,
}: StatsHeaderProps): JSX.Element {
    return (
        <AppHeader>
            <AppTitle>数据统计</AppTitle>
            <AppAction>
                <Button
                    variant="ghost"
                    size="icon"
                    aria-label="刷新"
                    tooltip="刷新"
                    isLoading={isRefreshing}
                    onClick={onRefresh}
                >
                    <RefreshCw className="size-3.5" />
                </Button>
            </AppAction>
            <AppDescription>
                {`${result?.isDelayed === true ? '数据可能延迟' : '按自然日结算，截至昨日'} · 起始 ${meta.since} · 跨度 ${String(meta.maxDays)} 天 · ${meta.granularity}`}
            </AppDescription>
            <AppSummary
                title={accountName}
                path="wechat"
                meta={`${WECHAT_STATS_DIMENSION_LABELS[dimension]} · ${meta.label}`}
                note={`${result?.beginDate ?? '—'} 至 ${result?.endDate ?? '—'}`}
            />
            <AppMenu>
                <SegmentedRail
                    items={DIMENSION_OPTIONS}
                    value={dimension}
                    onChange={onDimensionChange}
                    label="统计维度"
                    variant="outline"
                    isStretched
                />
            </AppMenu>
        </AppHeader>
    )
}
