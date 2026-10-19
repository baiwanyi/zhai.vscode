/**
 * AI 对话消息流容器：MessageScroller 组合（Provider 托管自动滚动、Item 以 messageId 作滚动锚点、
 * Button 自动显隐回到底部），空态交给 AiChatEmptyState 分派，sending 阶段显示准备上下文 Marker。
 * 写回状态由页面注入，本层按消息 id 决定是否为该条消息渲染写回入口。
 * 关键约束：末条消息作为滚动锚点，流式增长时保持贴底；本组件不处理消息内容渲染（见 AiChatMessageView）。
 */
import { Marker, MarkerContent, MarkerIcon } from '@components/ui/marker'
import {
    MessageScroller,
    MessageScrollerButton,
    MessageScrollerContent,
    MessageScrollerItem,
    MessageScrollerProvider,
    MessageScrollerViewport,
} from '@components/ui/message-scroller'
import { Spinner } from '@components/ui/spinner'
import type { AiMessage, AiRuntimeInfo, AiWriteScope } from '@shared/types/aiChat'
import { AiChatEmptyState } from './AiChatEmptyState'
import { AiChatMessageView } from './AiChatMessageView'
import type { Phase } from '../hooks/useAiChatSession'
import type { JSX } from 'react'

/** 写回状态：由页面 hook 组装，列表只按 id 匹配到具体消息 */
export interface AiChatListApplyState {
    appliableMessageIds: string[]
    appliedMessageIds: string[]
    applyingMessageId: string | null
    /** 每条消息对应的写回作用域，决定是否需要整篇覆盖确认 */
    scopes: Record<string, AiWriteScope>
    onApply: (messageId: string) => void
}

interface AiChatMessageListProps {
    messages: AiMessage[]
    lastMessageId: string | undefined
    phase: Phase
    runtime: AiRuntimeInfo | null
    hasApiKey: boolean
    applyState: AiChatListApplyState | null
    onSetupApiKey: () => void
}

export function AiChatMessageList({
    messages,
    lastMessageId,
    phase,
    runtime,
    hasApiKey,
    applyState,
    onSetupApiKey,
}: AiChatMessageListProps): JSX.Element {
    return (
        <MessageScrollerProvider defaultScrollPosition="end">
            <MessageScroller>
                <MessageScrollerViewport aria-label="对话消息">
                    <MessageScrollerContent className="gap-4 p-3">
                        {messages.length === 0 ? (
                            <AiChatEmptyState runtime={runtime} hasApiKey={hasApiKey} onSetupApiKey={onSetupApiKey} />
                        ) : null}
                        {messages.map((message) => (
                            <MessageScrollerItem
                                key={message.id}
                                messageId={message.id}
                                scrollAnchor={message.id === lastMessageId}
                            >
                                <AiChatMessageView
                                    message={message}
                                    applyAction={
                                        applyState?.appliableMessageIds.includes(message.id)
                                            ? {
                                                  appliable: true,
                                                  applied: applyState.appliedMessageIds.includes(message.id),
                                                  applying: applyState.applyingMessageId === message.id,
                                                  scope: applyState.scopes[message.id] ?? null,
                                                  onApply: () => applyState.onApply(message.id),
                                              }
                                            : undefined
                                    }
                                />
                            </MessageScrollerItem>
                        ))}
                        {phase === 'sending' ? (
                            <Marker>
                                <MarkerIcon>
                                    <Spinner />
                                </MarkerIcon>
                                <MarkerContent>正在准备上下文…</MarkerContent>
                            </Marker>
                        ) : null}
                    </MessageScrollerContent>
                </MessageScrollerViewport>
                <MessageScrollerButton />
            </MessageScroller>
        </MessageScrollerProvider>
    )
}
