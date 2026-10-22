/**
 * AI 对话空态分流：按运行时信息决定展示加载态还是 CodeBuddy 登录引导。
 * runtime 未加载显示加载态；加载后统一展示 CodeBuddy 通道引导（当前唯一通道）。
 * 组合同目录空态组件，自身不含消息渲染逻辑。
 */
import type { AiRuntimeInfo } from '@shared/types/aiChat'
import { AiChatCodebuddyState } from './AiChatCodebuddyState'
import { AiChatLoadingState } from './AiChatLoadingState'
import type { JSX } from 'react'

interface AiChatEmptyStateProps {
    runtime: AiRuntimeInfo | null
    onLoginCodebuddy: () => void
}

export function AiChatEmptyState({ runtime, onLoginCodebuddy }: AiChatEmptyStateProps): JSX.Element {
    if (runtime === null) {
        return <AiChatLoadingState />
    }
    return <AiChatCodebuddyState site={runtime.providerSite} onLogin={onLoginCodebuddy} />
}
