/**
 * 提示词按需查询：仅在用户点开某条请求时向宿主请求 ai/usage/prompt，关闭弹窗不发请求。
 * 复用约定：请求经 webview 公共 bridge，错误文案复用 ../utils；结果整包来自宿主（含 found 标记）。
 * 关键约束：requestId 切换时旧响应必须丢弃（清理标记比对），因此弹窗侧要用返回结果的 requestId
 * 与当前请求比对来判断是否已就绪，不能只看是否为 null。
 */
import { useEffect, useState } from 'react'
import type { AiUsagePromptResult } from '@shared/types/aiUsage'
import { request } from '../../../bridge'
import { toErrorText } from '../utils'

/** 提示词 hook 的对外状态 */
export interface AiUsagePromptState {
    prompt: AiUsagePromptResult | null
    error: string | null
}

export function useUsagePrompt(requestId: string | null): AiUsagePromptState {
    const [prompt, setPrompt] = useState<AiUsagePromptResult | null>(null)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (requestId === null) {
            return
        }
        let cancelled = false
        const run = async (): Promise<void> => {
            try {
                const payload = await request<AiUsagePromptResult>('ai/usage/prompt', { requestId })
                if (!cancelled) {
                    setPrompt(payload)
                    setError(null)
                }
            } catch (cause) {
                if (!cancelled) {
                    setError(toErrorText(cause))
                }
            }
        }
        void run()
        return (): void => {
            cancelled = true
        }
    }, [requestId])

    return { prompt, error }
}
