/**
 * 使用量页头：标题、刷新按钮、当前筛选范围的汇总（请求数、积分、tokens）、今日与本月积分卡片与数据来源说明。
 * 复用约定：汇总整包来自宿主，组件只做格式化；积分格式化复用 ../utils，周期卡片复用 ./UsagePeriodCard。
 * 关键约束：summary 为 null（首次加载或请求失败）时不渲染任何数字，避免显示成「0 次请求」误导用户；
 * 今日与本月是固定区间，只跟随模块筛选、不随时间范围筛选变化，口径差异必须在说明文字里写明；
 * 积分口径必须注明来自 CodeBuddy 会话记录，未同步的请求显示破折号，不能让人误以为是本地估算或平台账单；
 * 刷新按钮在请求进行中禁用并转圈，避免连点触发多次全量重扫。
 */
import { RefreshCw } from 'lucide-react'
import { Button } from '@components/ui/button'
import type { AiUsagePeriods, AiUsageSummary } from '@shared/types/aiUsage'
import { UsagePeriodCard } from './UsagePeriodCard'
import type { JSX } from 'react'
import { formatCredits, formatTokens } from '../utils'

interface UsageHeaderProps {
    summary: AiUsageSummary | null
    periods: AiUsagePeriods | null
    isLoading: boolean
    onRefresh: () => void
}

export function UsageHeader({ summary, periods, isLoading, onRefresh }: UsageHeaderProps): JSX.Element {
    return (
        <header className="flex flex-col gap-2 mb-2">
            <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                    <h1 className="font-heading text-lg mb-2">AI使用量</h1>
                    {summary !== null && (
                        <p className="text-muted-foreground">
                            共 {summary.requests} 次请求 · 合计 {formatCredits(summary.credits)} 积分 ·{' '}
                            {formatTokens(summary.tokens)} tokens
                        </p>
                    )}
                </div>
                <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto"
                    aria-label="刷新用量"
                    disabled={isLoading}
                    onClick={onRefresh}
                >
                    <RefreshCw className={isLoading ? 'size-4 animate-spin' : 'size-4'} />
                </Button>
            </div>
            <div className="grid max-w-md grid-cols-2 gap-2">
                <UsagePeriodCard label="今日积分" credits={periods?.today ?? null} />
                <UsagePeriodCard label="本月积分" credits={periods?.month ?? null} />
            </div>
        </header>
    )
}
