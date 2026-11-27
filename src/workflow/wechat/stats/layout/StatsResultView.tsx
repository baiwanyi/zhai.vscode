/**
 * 统计结果区：四态渲染与正常态装配。
 * 指标、趋势、分布、明细各由独立组件承担；三态走 Empty，停用提示走 Alert。
 */
import { BarChart3 } from 'lucide-react'
import type { WechatStatsQueryResult } from '@shared/types/wechat'
import { Empty } from '@webview/blocks/Empty'
import { Alert } from '@webview/components/Alert'
import { Button } from '@webview/components/Button'
import { BreakdownCard } from './BreakdownCard'
import { MetricToggleGroup } from './MetricToggleGroup'
import { StatsDetailsSection } from './StatsDetailsSection'
import { TrendChartCard } from './TrendChartCard'
import type { ArticleLinkRenderer } from './StatsDetailsSection'
import type { JSX } from 'react'
import { readSelectedMetric } from '../utils/statsMetric'

interface StatsResultViewProps {
    status: 'loading' | 'ready' | 'error'
    error: string | null
    result: WechatStatsQueryResult | null
    /** 空态说明，由调用方按视图元数据生成 */
    emptyDescription: string
    /** 停止维护提示 */
    deprecatedNotice?: string
    activeMetricKey: string
    onSelectMetric: (key: string) => void
    onRetry: () => void
    /** 明细链接渲染，缺省走微信白名单 */
    renderArticleLink?: ArticleLinkRenderer
}

export function StatsResultView({
    status,
    error,
    result,
    emptyDescription,
    deprecatedNotice,
    activeMetricKey,
    onSelectMetric,
    onRetry,
    renderArticleLink,
}: StatsResultViewProps): JSX.Element {
    if (status === 'error') {
        return (
            <Empty icon={BarChart3} title="读取失败" description={error ?? '请稍后重试'}>
                <Button variant="outline" onClick={onRetry}>
                    重试
                </Button>
            </Empty>
        )
    }
    if (status === 'loading') {
        return <Empty title="加载中..." isLoading />
    }
    if (result === null || (result.points.length === 0 && result.items.length === 0)) {
        return <Empty title="无数据" description={emptyDescription} />
    }
    const metric = readSelectedMetric(result.metrics, activeMetricKey)
    if (metric === undefined) {
        return <Empty title="暂无可用指标" description="该视图没有可展示的指标" />
    }
    return (
        <div className="flex w-full flex-col gap-3">
            {deprecatedNotice === undefined ? null : <Alert title="接口已停止维护" description={deprecatedNotice} />}
            <MetricToggleGroup metrics={result.metrics} activeKey={metric.key} onChange={onSelectMetric} />
            {result.points.length === 0 ? null : <TrendChartCard metric={metric} points={result.points} />}
            {result.breakdowns.length === 0 ? null : <BreakdownCard items={result.breakdowns} />}
            <StatsDetailsSection result={result} metric={metric} renderArticleLink={renderArticleLink} />
        </div>
    )
}
