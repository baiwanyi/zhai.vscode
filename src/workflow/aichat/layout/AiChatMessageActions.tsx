/**
 * AI 助手消息工具栏：提供回复复制入口，并展示本轮积分、tokens 与耗时。
 * 复用约定：复制走 @shared/utils/clipboard（成功切对勾、失败才提示），积分 / tokens / 耗时统一用
 * @shared/utils/format 折算，图标按钮取 @webview/components/Button，统计胶囊与悬停气泡统一由
 * @webview/components/StatBadge 收口（图标与数值经 children 组合），图标尺寸与笔触统一走
 * ACTION_ICON_CLASS，同一工具栏内视觉一致。
 * 关键约束：只由助手消息渲染，用户消息不出现工具栏；tokens 或耗时为 0 一律视为未知、不渲染对应胶囊；
 * 积分只认 CLI 对账值，null 不渲染胶囊（未知不等同于 0.00）；估算出的 tokens 必须在提示气泡里标注；
 * 复制内容为落库的 Markdown 原文；成功反馈只靠图标切换，不弹 toast，失败仍要明说。
 */
import { Check, Clock, Copy, Database, Tickets } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { AiMessage } from '@shared/types/aiChat'
import { copyToClipboard } from '@shared/utils/clipboard'
import { formatCredits, formatDuration, formatTokens } from '@shared/utils/format'
import { Button } from '@webview/components/Button'
import { StatBadge } from '@webview/components/StatBadge'
import type { JSX } from 'react'

/** 复制成功图标停留时长：够看清，又不至于一直挂在勾上 */
const COPIED_RESET_MS = 2000
/** 工具栏图标口径：lucide 默认 24px 会撑高胶囊与图标按钮，复制按钮与胶囊图标统一走这里，避免各写一份 */
const ACTION_ICON_CLASS = 'size-3.5 font-light'

interface AiChatMessageActionsProps {
    message: AiMessage
}

export function AiChatMessageActions({ message }: AiChatMessageActionsProps): JSX.Element {
    const { content, totalTokens, durationMs, tokensEstimated: isTokensEstimated, credits } = message
    const [isCopied, setIsCopied] = useState(false)
    const tokensTitle = isTokensEstimated
        ? `服务端未回传用量，按回复字数估算：共 ${String(totalTokens)} tokens`
        : `本轮消耗 ${String(totalTokens)} tokens`
    const durationTitle = `本轮耗时 ${String(durationMs)} 毫秒（含上下文准备与首字等待）`
    const creditsTitle =
        credits !== null && credits > 0
            ? `本轮消耗 ${formatCredits(credits)} 积分`
            : '本轮未产生积分消耗（订阅账号或未计费）'

    useEffect(() => {
        if (!isCopied) {
            return
        }
        const timer = setTimeout((): void => {
            setIsCopied(false)
        }, COPIED_RESET_MS)
        return (): void => {
            clearTimeout(timer)
        }
    }, [isCopied])

    /** 复制回复正文：成功只切对勾，失败提示但不抛错，避免打断面板 */
    async function handleCopy(): Promise<void> {
        const isSuccess = await copyToClipboard(content)
        if (!isSuccess) {
            toast.error('复制失败，请手动选中后复制')
            return
        }
        setIsCopied(true)
    }

    return (
        <div className="flex flex-wrap items-center gap-3">
            <Button
                variant="secondary"
                size="icon-xs"
                tooltip={isCopied ? '已复制' : '复制回复'}
                aria-label={isCopied ? '已复制' : '复制回复'}
                onClick={() => void handleCopy()}
            >
                {isCopied ? <Check className={ACTION_ICON_CLASS} /> : <Copy className={ACTION_ICON_CLASS} />}
            </Button>
            {credits === null ? null : (
                <StatBadge tooltip={creditsTitle}>
                    <Tickets aria-hidden="true" className={ACTION_ICON_CLASS} />
                    {`积分: ${formatCredits(credits)}`}
                </StatBadge>
            )}
            {totalTokens > 0 ? (
                <StatBadge tooltip={tokensTitle}>
                    <Database aria-hidden="true" className={ACTION_ICON_CLASS} />
                    {`Tokens: ${formatTokens(totalTokens)}`}
                </StatBadge>
            ) : null}
            {durationMs > 0 ? (
                <StatBadge tooltip={durationTitle}>
                    <Clock aria-hidden="true" className={ACTION_ICON_CLASS} />
                    {`耗时: ${formatDuration(durationMs)}`}
                </StatBadge>
            ) : null}
        </div>
    )
}
