/**
 * AI 对话待发送上下文清单：加载、单条移除与一键清空，数据经宿主 ai/context* 协议往返。
 * 移除 / 清空只回传宿主生成的引用 id；清单随会话快照变化由调用方（会话 hook）注入 setContexts 同步。
 * 关键约束：不持有文件路径等敏感信息，仅透传宿主生成的引用 id。
 */
import { useCallback, useState } from 'react'
import type { AiContextRef } from '@/shared/types/aiChat'
import { request } from '../../../bridge'
import { toErrorText } from '../utils'

/** 上下文 hook 的对外依赖：错误与提示由共享提示 hook 持有 */
export interface UseAiChatContextsOptions {
    onError: (error: string | null) => void
    onNotice: (notice: string | null) => void
}

/** 待发送上下文清单对外暴露的状态与操作 */
export interface AiChatContextsState {
    contexts: AiContextRef[]
    setContexts: (contexts: AiContextRef[]) => void
    loadContexts: () => Promise<void>
    removeContext: (id: string) => Promise<void>
    clearContexts: () => Promise<void>
}

export function useAiChatContexts({ onError, onNotice }: UseAiChatContextsOptions): AiChatContextsState {
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
                onNotice(null)
            } catch (cause) {
                onError(toErrorText(cause))
            }
        },
        [onError, onNotice],
    )

    const clearContexts = useCallback(async (): Promise<void> => {
        try {
            setContexts(await request<AiContextRef[]>('ai/context/clear'))
            onNotice(null)
        } catch (cause) {
            onError(toErrorText(cause))
        }
    }, [onError, onNotice])

    return { contexts, setContexts, loadContexts, removeContext, clearContexts }
}
