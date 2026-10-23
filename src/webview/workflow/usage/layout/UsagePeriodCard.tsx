/**
 * 周期积分卡片：页头展示单个固定区间的积分累计（今日 / 本月）。
 * 复用约定：数值格式化复用 ../utils，未知值显示破折号；区间由宿主按本地 0 点算好下发，本组件不做时间计算。
 * 关键约束：null 不得渲染成 0.00，否则会把「尚未对账」显示成零消耗。
 */
import type { JSX } from 'react'
import { formatCredits } from '../utils'

interface UsagePeriodCardProps {
    /** 指标名，形如「今日积分」 */
    label: string
    /** 区间内积分合计，null 表示该区间没有已对账记录 */
    credits: number | null
}

export function UsagePeriodCard({ label, credits }: UsagePeriodCardProps): JSX.Element {
    return (
        <div className="flex flex-col gap-0.5 rounded-md border px-3 py-2">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-semibold tabular-nums">{formatCredits(credits)}</span>
        </div>
    )
}
