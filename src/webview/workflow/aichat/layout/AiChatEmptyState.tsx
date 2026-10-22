/**
 * AI 对话空态分流：按运行时信息决定展示加载态、通道引导态还是欢迎引导。
 * runtime 未加载显示加载态；CodeBuddy 通道显示登录引导；DeepSeek 通道按密钥状态二选一。
 * 组合同目录空态组件，自身不含消息渲染逻辑。
 */
import type { AiRuntimeInfo } from '@shared/types/aiChat'
import { AiChatApiKeyState } from './AiChatApiKeyState'
import { AiChatCodebuddyState } from './AiChatCodebuddyState'
import { AiChatLoadingState } from './AiChatLoadingState'
import { AiChatWelcomeState } from './AiChatWelcomeState'
import type { JSX } from 'react'

interface AiChatEmptyStateProps {
    runtime: AiRuntimeInfo | null
    hasApiKey: boolean
    onSetupApiKey: () => void
    onLoginCodebuddy: () => void
}

export function AiChatEmptyState({
    runtime,
    hasApiKey,
    onSetupApiKey,
    onLoginCodebuddy,
}: AiChatEmptyStateProps): JSX.Element {
    if (runtime === null) {
        return <AiChatLoadingState />
    }
    if (runtime.provider === 'codebuddy') {
        return <AiChatCodebuddyState site={runtime.providerSite} onLogin={onLoginCodebuddy} />
    }
    return hasApiKey ? <AiChatWelcomeState /> : <AiChatApiKeyState onSetup={onSetupApiKey} />
}
