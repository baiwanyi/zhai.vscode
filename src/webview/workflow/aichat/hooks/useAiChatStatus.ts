/**
 * AI 对话提示状态：错误与操作提示（notice）的统一存放处，供各操作 hook 注入更新入口。
 * 独立成 hook 以避免会话 / 上下文 / 运行时 / 历史等 hook 之间的状态循环依赖。
 */
import { useState } from 'react'

/** 提示状态与更新入口 */
export interface AiChatStatus {
    error: string | null
    notice: string | null
    setError: (error: string | null) => void
    setNotice: (notice: string | null) => void
}

export function useAiChatStatus(): AiChatStatus {
    const [error, setError] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)
    return { error, notice, setError, setNotice }
}
