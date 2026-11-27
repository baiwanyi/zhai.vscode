/**
 * 逐项明细表：倒序展示条目，数值列跟随选中指标。
 * 标题缺省回落 id；指标缺失按 0，不回落到其他指标。
 */
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@components/ui/table'
import type { WechatStatsItem } from '@shared/types/wechat'
import type { ArticleLinkRenderer } from './StatsDetailsSection'
import type { JSX } from 'react'
import { formatStatsNumber, readReversed } from '../utils/statsFormat'
import { readItemValue } from '../utils/statsMetric'

interface ItemDetailsProps {
    items: WechatStatsItem[]
    metricKey: string | undefined
    renderArticleLink: ArticleLinkRenderer
}

export function ItemDetails({ items, metricKey, renderArticleLink }: ItemDetailsProps): JSX.Element {
    return (
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>标题</TableHead>
                    <TableHead>日期</TableHead>
                    <TableHead className="text-right">指标值</TableHead>
                    <TableHead className="w-20 text-right">原文</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {readReversed(items).map((item, index) => (
                    <TableRow key={`${item.id}-${item.date}-${String(index)}`} className="text-xs">
                        <TableCell className="max-w-[16rem] truncate" title={item.title}>
                            {item.title.length > 0 ? item.title : item.id}
                        </TableCell>
                        <TableCell className="text-muted-foreground tabular-nums">{item.date}</TableCell>
                        <TableCell className="text-right tabular-nums">
                            {formatStatsNumber(readItemValue(item, metricKey))}
                        </TableCell>
                        <TableCell className="text-right">{renderArticleLink(item)}</TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    )
}
