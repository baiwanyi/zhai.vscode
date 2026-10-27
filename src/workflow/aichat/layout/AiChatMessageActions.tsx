/**
 * AI 助手消息工具栏：提供回复复制入口，并展示本轮积分、tokens 与耗时。
 * 复用约定：复制走 @shared/utils/clipboard（成功与否按返回值提示），积分 / tokens / 耗时统一用
 * @shared/utils/format 折算，图标按钮取 @webview/components/Button、统计胶囊取 @components/ui/badge，
 * 精确值经 ui/tooltip 悬停展示，气泡沿用 Button 导出的暗底样式，同一工具栏内视觉统一。
 * 关键约束：只由助手消息渲染，用户消息不出现工具栏；tokens 或耗时为 0 一律视为未知、不渲染对应胶囊；
 * 积分只认 CLI 对账值，null 不渲染胶囊（未知不等同于 0.00）；估算出的 tokens 必须在提示气泡里标注；
 * 复制内容为落库的 Markdown 原文。
 */
import { CircleDollarSign, Clock, Copy, Database } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@components/ui/tooltip'
import type { AiMessage } from '@shared/types/aiChat'
import { copyToClipboard } from '@shared/utils/clipboard'
import { formatCredits, formatDuration, formatTokens } from '@shared/utils/format'
import { Button, TOOLTIP_CLASS } from '@webview/components/Button'
import type { LucideIcon } from 'lucide-react'
import type { JSX } from 'react'

interface AiChatMessageActionsProps {
    message: AiMessage
}

export function AiChatMessageActions({ message }: AiChatMessageActionsProps): JSX.Element {
    const { content, totalTokens, durationMs, tokensEstimated: isTokensEstimated, credits } = message
    const tokensTitle = isTokensEstimated
        ? `服务端未回传用量，按回复字数估算：共 ${String(totalTokens)} tokens`
        : `本轮消耗 ${String(totalTokens)} tokens`
    const durationTitle = `本轮耗时 ${String(durationMs)} 毫秒（含上下文准备与首字等待）`
    const creditsTitle =
        credits !== null && credits > 0
            ? `本轮消耗 ${formatCredits(credits)} 积分`
            : '本轮未产生积分消耗（订阅账号或未计费）'

    /** 复制回复正文：失败只提示、不抛错，避免打断面板 */
    async function handleCopy(): Promise<void> {
        const isSuccess = await copyToClipboard(content)
        if (isSuccess) {
            toast.success('已复制回复')
            return
        }
        toast.error('复制失败，请手动选中后复制')
    }

    return (
        <div className="flex flex-wrap items-center gap-3">
            <Button
                variant="secondary"
                size="icon-xs"
                tooltip="复制回复"
                aria-label="复制回复"
                onClick={() => void handleCopy()}
            >
                <Copy className="size-3.5" />
            </Button>
            {credits === null ? null : (
                <StatBadge icon={CircleDollarSign} label={`积分: ${formatCredits(credits)}`} tooltip={creditsTitle} />
            )}
            {totalTokens > 0 ? (
                <StatBadge icon={Database} label={`Tokens: ${formatTokens(totalTokens)}`} tooltip={tokensTitle} />
            ) : null}
            {durationMs > 0 ? (
                <StatBadge icon={Clock} label={`耗时: ${formatDuration(durationMs)}`} tooltip={durationTitle} />
            ) : null}
        </div>
    )
}

interface StatBadgeProps {
    icon: LucideIcon
    label: string
    /** 悬停展示的精确值：估算口径、毫秒数与构成说明都放在这里 */
    tooltip: string
}

/** 统计胶囊：精确值走 tooltip，不占消息正文宽度，气泡样式与复制按钮保持一致 */
function StatBadge({ icon: Icon, label, tooltip }: StatBadgeProps): JSX.Element {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Badge variant="outline" className="h-6 cursor-help gap-1.5 font-light">
                    <Icon aria-hidden="true" />
                    {label}
                </Badge>
            </TooltipTrigger>
            <TooltipContent side="top" className={TOOLTIP_CLASS}>
                {tooltip}
            </TooltipContent>
        </Tooltip>
    )
}
