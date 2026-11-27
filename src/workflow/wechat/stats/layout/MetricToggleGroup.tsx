/**
 * 指标切换栏：单选 ToggleGroup，点击切换趋势与明细的指标。
 * 三项排三列、其余两列；空值回传忽略，始终保留一个选中项。
 */
import { cn } from 'cn'
import { ToggleGroup, ToggleGroupItem } from '@components/ui/toggle-group'
import type { WechatStatsMetric } from '@shared/types/wechat'
import type { JSX } from 'react'
import { formatStatsValue } from '../utils/statsFormat'

interface MetricToggleGroupProps {
    metrics: WechatStatsMetric[]
    activeKey: string
    onChange: (key: string) => void
}

export function MetricToggleGroup({ metrics, activeKey, onChange }: MetricToggleGroupProps): JSX.Element {
    return (
        <ToggleGroup
            type="single"
            variant="outline"
            value={activeKey}
            aria-label="统计指标"
            className={cn('grid w-full gap-2', metrics.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}
            onValueChange={(value) => {
                if (value.length > 0) {
                    onChange(value)
                }
            }}
        >
            {metrics.map((metric) => (
                <ToggleGroupItem
                    key={metric.key}
                    value={metric.key}
                    className="flex h-auto flex-col items-start gap-1 rounded-xl p-3 text-left"
                >
                    <span className="text-xs text-muted-foreground">{metric.label}</span>
                    <span className="font-heading text-xl tabular-nums">{formatStatsValue(metric, metric.total)}</span>
                </ToggleGroupItem>
            ))}
        </ToggleGroup>
    )
}
