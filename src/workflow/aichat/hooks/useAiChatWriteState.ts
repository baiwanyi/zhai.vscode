/**
 * AI 对话写入状态：实时写入目标，经宿主 ai/writeState 往返，作为输入区的发送前置判断依据。
 * 复用约定：目标由宿主按当前编辑器推导，前端不做路径推断，也不参与白名单判断。
 * 关键约束：只回传宿主快照，读取失败经共享提示 hook 上报并保留上一次的值。
 */
import { useCallback, useState } from 'react'
import type { AiWriteState } from '@shared/types/aiChat'
import { request } from '@shared/utils/bridge'
import { toErrorText } from '@shared/utils/error'

/** 写入状态 hook 的对外依赖：读取失败经共享提示 hook 经 sonner 上报 */
export interface UseAiChatWriteStateOptions {
    onError: (error: string | null) => void
}

/** 写入状态对外暴露的状态与操作 */
export interface AiChatWriteStateResult {
    writeState: AiWriteState | null
    loadWriteState: () => Promise<void>
}

export function useAiChatWriteState({ onError }: UseAiChatWriteStateOptions): AiChatWriteStateResult {
    const [writeState, setWriteState] = useState<AiWriteState | null>(null)

    const loadWriteState = useCallback(async (): Promise<void> => {
        try {
            setWriteState(await request<AiWriteState>('ai/writeState'))
        } catch (cause) {
            onError(toErrorText(cause))
        }
    }, [onError])

    return { writeState, loadWriteState }
}
