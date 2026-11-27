/**
 * 分类分布卡片：来源、消息类型等占比条。
 * 峰值过滤非有限数，占比归一并夹到非负。
 */
import { Card, CardContent, CardHeader, CardTitle } from '@components/ui/card'
import type { WechatStatsBreakdown } from '@shared/types/wechat'
import type { JSX } from 'react'
import { formatStatsNumber, readBreakdownRatio } from '../utils/statsFormat'

interface BreakdownCardProps {
    items: WechatStatsBreakdown[]
}

export function BreakdownCard({ items }: BreakdownCardProps): JSX.Element {
    const peak = items.reduce((max, item) => Math.max(max, Number.isFinite(item.value) ? item.value : 0), 0)

    return (
        <Card size="sm">
            <CardHeader>
                <CardTitle className="text-xs text-muted-foreground">分布</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="flex flex-col gap-1.5">
                    {items.map((item) => (
                        <div key={item.label} className="flex items-center gap-2 text-xs">
                            <span className="w-24 shrink-0 truncate text-muted-foreground">{item.label}</span>
                            <div className="h-2 min-w-0 flex-1 rounded-full bg-muted">
                                <div
                                    className="h-2 rounded-full bg-primary/70"
                                    style={{ width: `${String(readBreakdownRatio(item.value, peak))}%` }}
                                />
                            </div>
                            <span className="w-16 shrink-0 text-right tabular-nums">
                                {formatStatsNumber(item.value)}
                            </span>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    )
}
