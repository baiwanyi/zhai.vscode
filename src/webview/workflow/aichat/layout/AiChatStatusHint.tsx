/**
 * AI 对话底部提示行：错误 → 操作提示 → 常态快捷键文案的三级回退展示。
 * 纯展示组件；错误态用 destructive 色，其余为弱化前景色。
 */
import { cn } from 'cn'
import type { JSX } from 'react'

interface AiChatStatusHintProps {
    error: string | null
    notice: string | null
    isGenerating: boolean
}

export function AiChatStatusHint({ error, notice, isGenerating }: AiChatStatusHintProps): JSX.Element {
    return (
        <p className={cn('text-center text-xs', error ? 'text-destructive' : 'text-muted-foreground')}>
            {error ??
                notice ??
                (isGenerating ? '正在生成，可随时停止' : 'Enter 发送 · Shift + Enter 换行 · Ctrl+Shift+L 聚焦')}
        </p>
    )
}
