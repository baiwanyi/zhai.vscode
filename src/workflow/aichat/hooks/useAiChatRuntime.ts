/**
 * AI 对话运行时信息：模型、今日 token 用量与预算、密钥是否存在，经宿主 ai/runtime 协议获取。
 * 密钥增删与运行时变更由宿主 state 广播（payload.kind = runtime）通知，由页面订阅后调用 loadRuntime 刷新。
 */
import { useCallback, useState } from 'react'
import type { AiRuntimeInfo } from '@shared/types/aiChat'
import { request } from '@shared/utils/bridge'
import { toErrorText } from '@shared/utils/error'

/** 运行时 hook 的对外依赖：错误由共享提示 hook 持有 */
export interface UseAiChatRuntimeOptions {
    onError: (error: string | null) => void
}

/** 运行时信息对外暴露的状态与操作 */
export interface AiChatRuntimeState {
    runtime: AiRuntimeInfo | null
    loadRuntime: () => Promise<void>
}

export function useAiChatRuntime({ onError }: UseAiChatRuntimeOptions): AiChatRuntimeState {
    const [runtime, setRuntime] = useState<AiRuntimeInfo | null>(null)

    const loadRuntime = useCallback(async (): Promise<void> => {
        try {
            setRuntime(await request<AiRuntimeInfo>('ai/runtime'))
        } catch (cause) {
            onError(toErrorText(cause))
        }
    }, [onError])

    return { runtime, loadRuntime }
}
