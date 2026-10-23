/**
 * 使用量页头：标题、刷新按钮、当前筛选范围的汇总（请求数、积分、tokens）与数据来源说明。
 * 复用约定：汇总整包来自宿主，组件只做格式化；积分格式化复用 ../utils，未知显示破折号而非 0。
 * 关键约束：summary 为 null（首次加载或请求失败）时不渲染任何数字，避免显示成「0 次请求」误导用户；
 * 积分口径必须注明来自 CodeBuddy 会话记录，未同步的请求显示破折号，不能让人误以为是本地估算或平台账单；
 * 刷新按钮在请求进行中禁用并转圈，避免连点触发多次全量重扫。
 */
import { RefreshCw } from 'lucide-react'
import { Button } from '@components/ui/button'
import type { AiUsageSummary } from '@shared/types/aiUsage'
import type { JSX } from 'react'
import { formatCredits, formatTokens } from '../utils'

interface UsageHeaderProps {
    summary: AiUsageSummary | null
    isLoading: boolean
    onRefresh: () => void
}

export function UsageHeader({ summary, isLoading, onRefresh }: UsageHeaderProps): JSX.Element {
    return (
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="font-semibold">AI使用量</h2>
            {summary !== null && (
                <p className="text-muted-foreground">
                    共 {summary.requests} 次请求 · 合计 {formatCredits(summary.credits)} 积分 ·{' '}
                    {formatTokens(summary.tokens)} tokens
                </p>
            )}
            <Button
                variant="ghost"
                size="icon"
                className="ml-auto"
                aria-label="刷新用量"
                title="刷新用量"
                disabled={isLoading}
                onClick={onRefresh}
            >
                <RefreshCw className={isLoading ? 'size-4 animate-spin' : 'size-4'} />
            </Button>
            <p className="text-muted-foreground w-full">积分取自 CodeBuddy 会话记录，未同步的请求显示 —</p>
        </header>
    )
}
