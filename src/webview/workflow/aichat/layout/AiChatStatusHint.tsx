/**
 * AI 对话底部提示行：模式提示与常态快捷键文案的二选一展示。
 * 纯展示组件；错误与操作结果已统一由 sonner 弹出，此处只留常驻的弱化提示。
 */
import type { JSX } from 'react'

interface AiChatStatusHintProps {
    /** 模式相关提示：如写作模式缺少可改写目标 */
    hint: string | null
    isGenerating: boolean
}

export function AiChatStatusHint({ hint, isGenerating }: AiChatStatusHintProps): JSX.Element {
    return (
        <p className="text-center text-muted-foreground">
            {hint ?? (isGenerating ? '正在生成，可随时停止' : 'Enter 发送 · Shift + Enter 换行 · Ctrl+Shift+L 聚焦')}
        </p>
    )
}
