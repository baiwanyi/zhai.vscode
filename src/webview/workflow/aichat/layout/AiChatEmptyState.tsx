/**
 * AI 对话空态分流：按运行时信息决定展示加载态还是 CodeBuddy 通道空态。
 * runtime 未加载显示加载态；加载后把登录态一并下传，已登录的站点不再展示登录引导。
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
    return (
        <AiChatCodebuddyState
            site={runtime.providerSite}
            loggedIn={runtime.loggedIn}
            userName={runtime.loggedInUser}
            onLogin={onLoginCodebuddy}
        />
    )
}
