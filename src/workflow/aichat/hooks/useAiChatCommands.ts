/**
 * AI 对话宿主命令触发：经 host/command 协议调用白名单内的宿主命令（设置密钥、登录账号、打开插件设置等）。
 * 复用约定：命令白名单见 src/modules/common/webviewCommands.ts；常用命令在此包装成语义方法，
 * 调用方不再在 JSX 里直接写命令名。本 hook 只透传命令名，不承载任何业务状态。
 * 关键约束：语义方法只做命名包装，不改命令字符串本身——白名单以宿主侧为准。
 */
import { useCallback, useMemo } from 'react'
import { request } from '@shared/utils/bridge'
import { toErrorText } from '@shared/utils/error'

/** 登录 CodeBuddy 账号的宿主命令：空状态与运行时提示共用 */
const LOGIN_CODEBUDDY_COMMAND = 'zhai.ai.loginCodebuddy'

/** 宿主命令 hook 的对外依赖：错误由共享提示 hook 持有 */
export interface UseAiChatCommandsOptions {
    onError: (error: string | null) => void
}

/** 宿主命令触发对外暴露的操作 */
export interface AiChatCommandsState {
    runHostCommand: (command: string) => Promise<void>
    /** 拉起 CodeBuddy 登录：登录结果由宿主广播运行时变更 */
    runLoginCodebuddy: () => Promise<void>
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

    const runLoginCodebuddy = useCallback(async (): Promise<void> => {
        await runHostCommand(LOGIN_CODEBUDDY_COMMAND)
    }, [runHostCommand])

    return useMemo(() => ({ runHostCommand, runLoginCodebuddy }), [runHostCommand, runLoginCodebuddy])
}
