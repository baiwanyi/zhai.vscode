/**
 * 逐日明细表：倒序展示时间序列，数值列与当前指标同源。
 * date 在分时视图带小时后缀，天然唯一；指标缺失按 0。
 */
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@components/ui/table'
import type { WechatStatsDataPoint, WechatStatsMetric } from '@shared/types/wechat'
import type { JSX } from 'react'
import { formatStatsValue, readReversed } from '../utils/statsFormat'

interface DailyDetailsProps {
    metric: WechatStatsMetric
    points: WechatStatsDataPoint[]
}

export function DailyDetails({ metric, points }: DailyDetailsProps): JSX.Element {
    return (
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>日期</TableHead>
                    <TableHead className="text-right">{metric.label}</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {readReversed(points).map((point) => (
                    <TableRow key={point.date} className="text-xs">
                        <TableCell className="text-muted-foreground tabular-nums">{point.date}</TableCell>
                        <TableCell className="text-right tabular-nums">
                            {formatStatsValue(metric, point.values[metric.key] ?? 0)}
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    )
}
