/**
 * AI 对话消息内引用条目：与正文同属一条对话内容，随消息一起展示在用户气泡内。
 * 复用 @/components/ui 的 Badge 呈现展示标签，纯展示组件。
 * 关键约束：只展示宿主下发的 label 与 displayPath，不拼装任何路径。
 */
import { Badge } from '@/components/ui/badge'
import type { AiContextRef } from '@/shared/types/aiChat'
import type { JSX } from 'react'

interface AiChatMessageRefsProps {
    refs: AiContextRef[]
}

export function AiChatMessageRefs({ refs }: AiChatMessageRefsProps): JSX.Element | null {
    if (refs.length === 0) {
        return null
    }
    return (
        <div className="flex flex-wrap gap-1">
            {refs.map((ref) => (
                <Badge key={ref.id} variant="secondary" className="max-w-full font-normal" title={ref.displayPath}>
                    <span className="min-w-0 truncate">{ref.label}</span>
                </Badge>
            ))}
        </div>
    )
}
