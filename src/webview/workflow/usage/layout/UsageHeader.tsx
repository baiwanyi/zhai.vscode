/**
 * 使用量页头：标题与当前筛选范围的汇总（请求数、积分、tokens）。
 * 复用约定：汇总整包来自宿主，组件只做格式化；积分格式化复用 ../utils，未知显示破折号而非 0。
 * 关键约束：summary 为 null（首次加载或请求失败）时不渲染任何数字，避免显示成「0 次请求」误导用户。
 */
import type { AiUsageSummary } from '@shared/types/aiUsage'
import type { JSX } from 'react'
import { formatCredits, formatTokens } from '../utils'

interface UsageHeaderProps {
    summary: AiUsageSummary | null
}

export function UsageHeader({ summary }: UsageHeaderProps): JSX.Element {
    return (
        <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="font-semibold">AI使用量</h2>
            {summary !== null && (
                <p className="text-muted-foreground">
                    共 {summary.requests} 次请求 · 合计 {formatCredits(summary.credits)} 积分 ·{' '}
                    {formatTokens(summary.tokens)} tokens
                </p>
            )}
        </header>
    )
}
