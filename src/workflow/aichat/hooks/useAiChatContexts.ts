/**
 * AI 对话待发送上下文清单：加载与单条移除，数据经宿主 ai/context 与 ai/context/remove 协议往返。
 * 清单随会话快照变化由调用方（会话 hook）注入 setContexts 同步。
 * 关键约束：不持有文件路径等敏感信息，仅透传宿主生成的引用 id。
 */
import { useCallback, useState } from 'react'
import type { AiContextRef } from '@shared/types/aiChat'
import { request } from '@shared/utils/bridge'
import { toErrorText } from '@shared/utils/error'

/** 上下文 hook 的对外依赖：错误由共享提示 hook 持有 */
export interface UseAiChatContextsOptions {
    onError: (error: string | null) => void
}

/** 待发送上下文清单对外暴露的状态与操作 */
export interface AiChatContextsState {
    contexts: AiContextRef[]
    setContexts: (contexts: AiContextRef[]) => void
    loadContexts: () => Promise<void>
    removeContext: (id: string) => Promise<void>
}

export function useAiChatContexts({ onError }: UseAiChatContextsOptions): AiChatContextsState {
    const [contexts, setContexts] = useState<AiContextRef[]>([])

    const loadContexts = useCallback(async (): Promise<void> => {
        try {
            setContexts(await request<AiContextRef[]>('ai/context'))
        } catch (cause) {
            onError(toErrorText(cause))
        }
    }, [onError])

    /** 移除单条上下文引用：只回传宿主生成的 id */
    const removeContext = useCallback(
        async (id: string): Promise<void> => {
            try {
                setContexts(await request<AiContextRef[]>('ai/context/remove', { id }))
            } catch (cause) {
                onError(toErrorText(cause))
            }
        },
        [onError],
    )

    return { contexts, setContexts, loadContexts, removeContext }
}
