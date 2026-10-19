/**
 * AI 对话用户消息首行的引用徽章组：随命令徽章同行排列，由调用方提供布局容器。
 * 复用 @/components/ui 的 Badge 与 ../utils 的文件名折算，纯展示组件。
 * 关键约束：徽章只展示文件名（完整路径进悬浮提示），配色随用户气泡前景色，不做独立底色；
 * 与命令徽章统一 align-top，依赖调用方的 20px 行高（leading-5）与徽章高度重合。
 */
import { Badge } from '@/components/ui/badge'
import type { AiContextRef } from '@/shared/types/aiChat'
import type { JSX } from 'react'
import { toContextFileName } from '../utils'

interface AiChatMessageRefsProps {
    refs: AiContextRef[]
}

export function AiChatMessageRefs({ refs }: AiChatMessageRefsProps): JSX.Element | null {
    if (refs.length === 0) {
        return null
    }
    return (
        <>
            {refs.map((ref) => (
                <Badge
                    key={ref.id}
                    variant="secondary"
                    className="mr-1.5 max-w-56 border-0 bg-primary-foreground/15 align-top font-normal text-primary-foreground"
                    title={ref.displayPath}
                >
                    <span className="min-w-0 truncate">{toContextFileName(ref)}</span>
                </Badge>
            ))}
        </>
    )
}
