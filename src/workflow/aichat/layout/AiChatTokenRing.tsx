/**
 * AI 对话上下文圆环：以环形进度展示当前会话的上下文占用（已用 / 模型窗口），点开浮层查看明细。
 * 复用 @components/ui 的 Popover 与 @webview/components/Button，token 折算沿用 ../utils 的统一口径，
 * 颜色随占用比例分三档（≥70% 琥珀、≥90% 危险）。
 * 关键约束：窗口未知（windowTokens 为 0）时展示灰环且不给占比，绝不编造分母；
 * 数值全部来自宿主下发的会话快照与流末回传，本层不做任何估算。
 */
import {
    Popover,
    PopoverContent,
    PopoverDescription,
    PopoverHeader,
    PopoverTitle,
    PopoverTrigger,
} from '@components/ui/popover'
import type { AiContextUsage } from '@shared/types/aiChat'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'
import { formatTokens } from '../utils'

/** 圆环半径与周长（viewBox 24×24，线宽 3） */
const RADIUS = 9
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

interface AiChatTokenRingProps {
    /** 当前会话上下文占用：null 表示尚未生成过，窗口 0 表示模型档位未知 */
    usage: AiContextUsage | null
}

export function AiChatTokenRing({ usage }: AiChatTokenRingProps): JSX.Element {
    const used = usage?.usedTokens ?? 0
    const windowTokens = usage?.windowTokens ?? 0
    const hasWindow = windowTokens > 0
    const hasUsage = usage !== null && used > 0
    const ratio = hasWindow ? Math.min(used / windowTokens, 1) : 0
    const percent = hasWindow ? ((used / windowTokens) * 100).toFixed(1) : '0.0'
    const remaining = Math.max(windowTokens - used, 0)
    const label = hasWindow
        ? `${percent}% · ${formatTokens(used)} / ${formatTokens(windowTokens)} 上下文已使用`
        : '上下文窗口未知'
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
                            className={hasUsage && hasWindow ? tone : 'stroke-muted-foreground/30'}
                        />
                    </svg>
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-60">
                <PopoverHeader>
                    <PopoverTitle>上下文用量</PopoverTitle>
                </PopoverHeader>
                {hasWindow ? (
                    <div className="flex flex-col gap-1">
                        <span className="flex justify-between gap-2">
                            <span className="text-muted-foreground">已用</span>
                            <span>{formatTokens(used)}</span>
                        </span>
                        <span className="flex justify-between gap-2">
                            <span className="text-muted-foreground">窗口</span>
                            <span>{formatTokens(windowTokens)}</span>
                        </span>
                        <span className="flex justify-between gap-2">
                            <span className="text-muted-foreground">剩余</span>
                            <span>{formatTokens(remaining)}</span>
                        </span>
                        <span className="flex justify-between gap-2">
                            <span className="text-muted-foreground">占比</span>
                            <span>{percent}%</span>
                        </span>
                    </div>
                ) : (
                    <PopoverDescription>暂未读取到当前模型的上下文窗口，完成一轮生成后自动更新。</PopoverDescription>
                )}
                <PopoverDescription>统计最近一轮请求带上的系统提示、历史消息与引用，不含本轮回复。</PopoverDescription>
            </PopoverContent>
        </Popover>
    )
}
