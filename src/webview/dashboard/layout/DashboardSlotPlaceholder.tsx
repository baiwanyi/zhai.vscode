/**
 * 概览槽位占位：以虚线边框与说明文字替代空白矩形，明确表达「内容待接入」。
 * 复用 @components/ui 的 card 与 empty；接入图表时替换本组件在 DashboardSlots 中的位置即可。
 * 关键约束：最小高度已锁定，替换为真实图表后不得引起概览区布局跳动。
 */
import { ChartColumn } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '@components/ui/empty'
import type { JSX } from 'react'

interface DashboardSlotPlaceholderProps {
    title: string
    text: string
}

export function DashboardSlotPlaceholder({ title, text }: DashboardSlotPlaceholderProps): JSX.Element {
    return (
        <Card size="sm" className="min-h-28">
            <CardHeader>
                <CardTitle>{title}</CardTitle>
            </CardHeader>
            <CardContent className="flex min-h-16 items-center">
                <Empty className="border px-3 py-4">
                    <EmptyHeader>
                        <EmptyMedia variant="icon">
                            <ChartColumn />
                        </EmptyMedia>
                        <EmptyDescription>{text}</EmptyDescription>
                    </EmptyHeader>
                </Empty>
            </CardContent>
        </Card>
    )
}
