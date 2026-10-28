/**
 * AI 对话 Token 圆环：以环形进度展示当日已用与预算，点开浮层查看明细。
 * 复用 @components/ui 的 Button、Popover 与 ../utils 的 token 折算，颜色随占用比例分三档。
 * 关键约束：预算未配置时展示灰环且不可点；环内数值全部来自宿主下发的运行时信息。
 */
import {
    Popover,
    PopoverContent,
    PopoverDescription,
    PopoverHeader,
    PopoverTitle,
    PopoverTrigger,
} from '@components/ui/popover'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'
import { formatTokens } from '../utils'

/** 圆环半径与周长（viewBox 24×24，线宽 3） */
const RADIUS = 9
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

interface AiChatTokenRingProps {
    used: number
    budget: number
}

export function AiChatTokenRing({ used, budget }: AiChatTokenRingProps): JSX.Element {
    const isAvailable = budget > 0
    const ratio = isAvailable ? Math.min(used / budget, 1) : 0
    const remaining = Math.max(budget - used, 0)
    const label = isAvailable
        ? `今日已用 ${formatTokens(used)}，预算 ${formatTokens(budget)} tokens`
        : '未设置每日 Token 预算'
    const tone = ratio >= 0.9 ? 'stroke-destructive' : ratio >= 0.7 ? 'stroke-amber-500' : 'stroke-primary'

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-full text-muted-foreground"
                    tooltip={label}
                    aria-label={label}
                    disabled={!isAvailable}
                >
                    <svg viewBox="0 0 24 24" className="size-4 -rotate-90" aria-hidden="true">
                        <circle
                            cx="12"
                            cy="12"
                            r={RADIUS}
                            fill="none"
                            strokeWidth="3"
                            className="stroke-muted-foreground/30"
                        />
                        <circle
                            cx="12"
                            cy="12"
                            r={RADIUS}
                            fill="none"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeDasharray={CIRCUMFERENCE}
                            strokeDashoffset={CIRCUMFERENCE * (1 - ratio)}
                            className={isAvailable ? tone : 'stroke-muted-foreground/30'}
                        />
                    </svg>
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56">
                <PopoverHeader>
                    <PopoverTitle>今日 Token 用量</PopoverTitle>
                </PopoverHeader>
                {isAvailable ? (
                    <div className="flex flex-col gap-1">
                        <span className="flex justify-between gap-2">
                            <span className="text-muted-foreground">已用</span>
                            <span>{formatTokens(used)}</span>
                        </span>
                        <span className="flex justify-between gap-2">
                            <span className="text-muted-foreground">预算</span>
                            <span>{formatTokens(budget)}</span>
                        </span>
                        <span className="flex justify-between gap-2">
                            <span className="text-muted-foreground">剩余</span>
                            <span>{formatTokens(remaining)}</span>
                        </span>
                    </div>
                ) : (
                    <PopoverDescription>预算为 0，可在插件设置中调整每日 Token 预算。</PopoverDescription>
                )}
                <PopoverDescription>每日 0 点重置。</PopoverDescription>
            </PopoverContent>
        </Popover>
    )
}
