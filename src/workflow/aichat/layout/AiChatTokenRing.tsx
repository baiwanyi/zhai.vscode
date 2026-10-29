/**
 * AI 对话上下文圆环：以环形进度展示当前会话的上下文占用（已用 / 模型窗口），点开浮层查看明细。
 * 复用 @components/ui 的 Popover 与 @webview/components/Button，token 折算沿用 ../utils 的统一口径，
 * 颜色随占用比例分三档（≥70% 琥珀、≥90% 危险）。
 * 关键约束：任何情况下都给出具体数字 —— 没生成过、窗口未就绪一律按 0 呈现，
 * 不显示「尚未生成」「窗口未知」等空态文案，也不编造分母；
 * 会话尚无占用时分母取运行时带回的模型窗口；数值全部来自会话快照、流末回传与运行时窗口，本层不做估算。
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
    /** 当前会话上下文占用：null 表示本轮还没有产出数据，按 0 渲染 */
    usage: AiContextUsage | null
    /** 窗口兜底：会话尚无占用数据时用当前模型档位撑起分母，保证初始态显示 0% 而不是空态 */
    windowTokens: number
}

export function AiChatTokenRing({ usage, windowTokens: fallbackWindowTokens }: AiChatTokenRingProps): JSX.Element {
    const used = usage?.usedTokens ?? 0
    const windowTokens = usage?.windowTokens ?? fallbackWindowTokens
    const hasWindow = windowTokens > 0
    const hasUsage = used > 0
    const ratio = hasWindow ? Math.min(used / windowTokens, 1) : 0
    const percent = hasWindow ? ((used / windowTokens) * 100).toFixed(1) : '0.0'
    const remaining = Math.max(windowTokens - used, 0)
    // 始终给出具体数字：没生成过、窗口未就绪都按 0 呈现，不显示空态文案
    const label = `${percent}% · ${formatTokens(used)} / ${formatTokens(windowTokens)} 上下文已使用`
    const tone = ratio >= 0.9 ? 'stroke-destructive' : ratio >= 0.7 ? 'stroke-amber-500' : 'stroke-foreground'

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
                    <svg viewBox="0 0 24 24" className="size-5 -rotate-90" aria-hidden="true">
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
                <PopoverDescription>统计最近一轮请求带上的系统提示、历史消息与引用，不含本轮回复。</PopoverDescription>
            </PopoverContent>
        </Popover>
    )
}
