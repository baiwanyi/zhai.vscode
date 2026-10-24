/**
 * AI 对话宿主命令触发：经 host/command 协议调用白名单内的宿主命令（设置密钥、打开插件设置等）。
 * 命令白名单见 src/modules/common/webviewCommands.ts；本 hook 只透传命令名，不承载任何业务状态。
 */
import { useCallback } from 'react'
import { request } from '@shared/utils/bridge'
import { toErrorText } from '../utils'

/** 宿主命令 hook 的对外依赖：错误由共享提示 hook 持有 */
export interface UseAiChatCommandsOptions {
    onError: (error: string | null) => void
}

/** 宿主命令触发对外暴露的操作 */
export interface AiChatCommandsState {
    runHostCommand: (command: string) => Promise<void>
}

export function useAiChatCommands({ onError }: UseAiChatCommandsOptions): AiChatCommandsState {
    /** 触发白名单内的宿主命令（设置密钥、打开设置等） */
    const runHostCommand = useCallback(
        async (command: string): Promise<void> => {
            try {
                await request('host/command', command)
            } catch (cause) {
                onError(toErrorText(cause))
            }
        },
        [onError],
    )

    return { runHostCommand }
}
