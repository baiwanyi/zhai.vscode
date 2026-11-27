/**
 * 趋势卡片：当前指标的柱状图。
 * data 与 config 用 useMemo 稳定引用，避免 recharts 重复布局。
 */
import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@components/ui/card'
import { ChartContainer } from '@components/ui/chart'
import type { ChartConfig } from '@components/ui/chart'
import type { WechatStatsDataPoint, WechatStatsMetric } from '@shared/types/wechat'
import type { JSX } from 'react'
import { formatStatsValue } from '../utils/statsFormat'

/** 图表初始尺寸：固定配置提到模块级，保持引用稳定 */
const CHART_INITIAL_DIMENSION = { width: 320, height: 160 } as const

interface TrendChartCardProps {
    metric: WechatStatsMetric
    points: WechatStatsDataPoint[]
}

export function TrendChartCard({ metric, points }: TrendChartCardProps): JSX.Element {
    const data = useMemo(
        () => points.map((point) => ({ date: point.date, value: point.values[metric.key] ?? 0 })),
        [points, metric.key],
    )
    const config = useMemo<ChartConfig>(
        () => ({ value: { label: metric.label, color: 'var(--chart-1)' } }),
        [metric.label],
    )

    return (
        <Card size="sm">
            <CardHeader>
                <CardTitle className="text-xs text-muted-foreground">{`${metric.label}趋势`}</CardTitle>
            </CardHeader>
            <CardContent>
                <ChartContainer config={config} className="h-40 w-full" initialDimension={CHART_INITIAL_DIMENSION}>
                    <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                        <CartesianGrid vertical={false} strokeDasharray="3 3" />
                        <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={24} tickMargin={6} />
                        <YAxis
                            tickLine={false}
                            axisLine={false}
                            width={44}
                            tickFormatter={(value: number) => String(value)}
                        />
                        <Tooltip
                            cursor={false}
                            formatter={(value) => [formatStatsValue(metric, Number(value)), metric.label]}
                            contentStyle={{ fontSize: 11, borderRadius: 8 }}
                        />
                        <Bar dataKey="value" radius={[3, 3, 0, 0]} fill="var(--chart-1)" isAnimationActive={false} />
                    </BarChart>
                </ChartContainer>
            </CardContent>
        </Card>
    )
}
