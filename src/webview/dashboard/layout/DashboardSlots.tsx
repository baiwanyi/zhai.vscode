/**
 * 仪表盘概览区：并列两个卡片式槽位，分别预留写作趋势与模块分布的位置。
 * 组合同目录 DashboardSlotPlaceholder 呈现占位态，接入图表时逐个替换槽位内容。
 * 关键约束：宽度窄于容器断点时纵向堆叠，保证侧栏收窄后仍可读。
 */
import { DashboardSlotPlaceholder } from './DashboardSlotPlaceholder'
import type { JSX } from 'react'

export function DashboardSlots(): JSX.Element {
    return (
        <div className="@container">
            <div className="grid gap-2 @sm:grid-cols-2">
                <DashboardSlotPlaceholder title="写作趋势" text="图表接入后展示字数与篇数变化" />
                <DashboardSlotPlaceholder title="模块分布" text="图表接入后展示各模块内容占比" />
            </div>
        </div>
    )
}
