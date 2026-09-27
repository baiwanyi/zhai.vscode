/**
 * AI 对话空态分派器：无消息时按运行时状态选择占位——
 * runtime 未加载显示加载态，已配置密钥显示欢迎引导，否则显示密钥配置引导（AC-6）。
 * 组合同目录三个空态组件，自身不含消息渲染逻辑。
 */
import type { AiRuntimeInfo } from '@/shared/types/aiChat'
import { AiChatApiKeyState } from './AiChatApiKeyState'
import { AiChatLoadingState } from './AiChatLoadingState'
import { AiChatWelcomeState } from './AiChatWelcomeState'
import type { JSX } from 'react'

interface AiChatEmptyStateProps {
    runtime: AiRuntimeInfo | null
    hasApiKey: boolean
    onSetupApiKey: () => void
}

export function AiChatEmptyState({ runtime, hasApiKey, onSetupApiKey }: AiChatEmptyStateProps): JSX.Element {
    if (runtime === null) {
        return <AiChatLoadingState />
    }
    return hasApiKey ? <AiChatWelcomeState /> : <AiChatApiKeyState onSetup={onSetupApiKey} />
}
