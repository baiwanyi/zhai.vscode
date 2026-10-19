/**
 * AI 对话会话元信息：会话标题与运行时用量行（模型、今日 token 用量 / 预算）。
 * 复用 ../utils 的 token 折算；为纯展示组件，无任何回调依赖。
 */
import type { AiRuntimeInfo } from '@shared/types/aiChat'
import type { JSX } from 'react'
import { formatTokens } from '../utils'

interface AiChatSessionMetaProps {
    title: string
    runtime: AiRuntimeInfo | null
}

export function AiChatSessionMeta({ title, runtime }: AiChatSessionMetaProps): JSX.Element {
    return (
        <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-sm font-medium">{title}</span>
            <span className="truncate text-xs text-muted-foreground">
                {runtime
                    ? `${runtime.model} · 今日 ${formatTokens(runtime.usedTokensToday)} / ${formatTokens(runtime.dailyTokenBudget)} tokens`
                    : '正在读取配置…'}
            </span>
        </div>
    )
}
