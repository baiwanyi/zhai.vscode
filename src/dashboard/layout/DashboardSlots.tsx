/**
 * 仪表盘概览区：纵向排列的卡片式槽位，首位预留写作趋势，次位为待办事项模块。
 * 组合同目录 DashboardTodo 与 DashboardSlotPlaceholder，后续图表接入时替换占位槽位。
 * 关键约束：槽位一律全宽——待办模块含清单标签、条目列表与输入区，半宽下无法使用。
 */
import { DashboardSlotPlaceholder } from './DashboardSlotPlaceholder'
import type { JSX } from 'react'
import { DashboardTodo } from '../todo/DashboardTodo'

export function DashboardSlots(): JSX.Element {
    return (
        <div className="flex flex-col gap-2 py-1">
            <DashboardSlotPlaceholder title="写作趋势" text="图表接入后展示字数与篇数变化" />
            <DashboardTodo />
        </div>
    )
}
