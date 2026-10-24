/**
 * 使用量页头汇总：当前筛选范围的请求数 / 积分 / tokens 说明，以及今日与本月积分卡片。
 * 复用约定：汇总整包来自宿主、格式化复用 ../utils，说明文案取 components/AppPage 的 AppDescription，
 * 由页面放进 AppHeader，保证标题区与卡片不随表格滚动；周期卡片复用 ./UsagePeriodCard。
 * 关键约束：summary 为 null（首次加载或请求失败）时不渲染任何数字，避免显示成「0 次请求」误导用户；
 * 今日与本月是固定区间，只跟随模块筛选、不随时间范围筛选变化，口径差异必须在说明文字里写明；
 * 积分口径必须注明来自 CodeBuddy 会话记录，未同步的请求显示破折号，不能让人误以为是本地估算或平台账单。
 */
import type { AiUsagePeriods, AiUsageSummary } from '@shared/types/aiUsage'
import { AppDescription } from '@webview/components/AppPage'
import { UsagePeriodCard } from './UsagePeriodCard'
import type { JSX } from 'react'
import { formatCredits, formatTokens } from '../utils'

interface UsageHeaderProps {
    summary: AiUsageSummary | null
    periods: AiUsagePeriods | null
}

export function UsageHeader({ summary, periods }: UsageHeaderProps): JSX.Element {
    return (
        <>
            {summary !== null && (
                <AppDescription>
                    共 {summary.requests} 次请求 · 合计 {formatCredits(summary.credits)} 积分 ·{' '}
                    {formatTokens(summary.tokens)} tokens
                </AppDescription>
            )}
            <div className="grid max-w-md grid-cols-2 gap-2">
                <UsagePeriodCard label="今日积分" credits={periods?.today ?? null} />
                <UsagePeriodCard label="本月积分" credits={periods?.month ?? null} />
            </div>
        </>
    )
}
