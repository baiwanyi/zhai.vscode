/**
 * AI 对话会话元信息：会话标题与运行时用量行（通道或模型、今日 token 用量）。
 * 复用 ../utils 的 token 折算；为纯展示组件，无任何回调依赖。
 * 关键约束：订阅制通道（CodeBuddy）不展示预算分母，避免给出无效的额度暗示。
 */
import type { AiRuntimeInfo } from '@shared/types/aiChat'
import type { JSX } from 'react'
import { formatTokens } from '../utils'

interface AiChatSessionMetaProps {
    title: string
    runtime: AiRuntimeInfo | null
}

export function AiChatSessionMeta({ title, runtime }: AiChatSessionMetaProps): JSX.Element {
    let usageText = '正在读取配置…'
    if (runtime !== null) {
        usageText = `CodeBuddy · 今日 ${formatTokens(runtime.usedTokensToday)} tokens`
    }
    return (
        <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate font-medium">{title}</span>
            <span className="truncate text-muted-foreground">{usageText}</span>
        </div>
    )
}
