/**
 * 用量表格：时间、积分消耗、模型、请求、模块五列，请求列可点击查看当轮提示词。
 * 复用约定：表格复用 @components/ui/table，请求入口复用 button 的 link 变体，模块标识用 badge 呈现，
 * 空列表复用 ui/empty 呈现而非留白；展示格式化统一走 ../utils，组件本身不做数值换算。
 * 关键约束：积分未知显示破折号（不得显示 0.00）；请求 id 只截短展示，完整值放在 tooltip 上，
 * 空列表必须渲染一行提示而不是留白，避免被误认为加载失败。
 */
import { FileText } from 'lucide-react'
import { Badge } from '@components/ui/badge'
import { Button } from '@components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@components/ui/empty'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@components/ui/tooltip'
import type { AiUsageItem } from '@shared/types/aiUsage'
import type { JSX } from 'react'
import { formatCredits, formatUsageTime, readModuleLabel, shortRequestId } from '../utils'

/** 列数：空态行的 colSpan 依赖它 */
const COLUMN_COUNT = 5

interface UsageTableProps {
    items: AiUsageItem[]
    /** 点击请求 id：由页面决定打开哪个弹窗 */
    onOpenRequest: (item: AiUsageItem) => void
}

export function UsageTable({ items, onOpenRequest }: UsageTableProps): JSX.Element {
    return (
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>时间</TableHead>
                    <TableHead className="text-right">积分消耗</TableHead>
                    <TableHead>模型</TableHead>
                    <TableHead>请求</TableHead>
                    <TableHead>模块</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {items.length === 0 ? (
                    <TableRow>
                        <TableCell colSpan={COLUMN_COUNT}>
                            <Empty className="py-4">
                                <EmptyHeader>
                                    <EmptyMedia variant="icon">
                                        <FileText />
                                    </EmptyMedia>
                                    <EmptyTitle>当前筛选范围没有用量记录</EmptyTitle>
                                    <EmptyDescription>调整时间范围或模块筛选后重试。</EmptyDescription>
                                </EmptyHeader>
                            </Empty>
                        </TableCell>
                    </TableRow>
                ) : (
                    items.map((item) => (
                        <TableRow key={item.id}>
                            <TableCell className="text-muted-foreground">{formatUsageTime(item.createdAt)}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatCredits(item.credits)}</TableCell>
                            <TableCell>{item.model.length > 0 ? item.model : 'Auto'}</TableCell>
                            <TableCell>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            variant="link"
                                            className="h-auto p-0 font-mono"
                                            aria-label={`查看请求 ${item.requestId} 的提示词`}
                                            onClick={() => onOpenRequest(item)}
                                        >
                                            {shortRequestId(item.requestId)}
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>{item.requestId}</TooltipContent>
                                </Tooltip>
                            </TableCell>
                            <TableCell>
                                <Badge variant="secondary">{readModuleLabel(item.module)}</Badge>
                            </TableCell>
                        </TableRow>
                    ))
                )}
            </TableBody>
        </Table>
    )
}
