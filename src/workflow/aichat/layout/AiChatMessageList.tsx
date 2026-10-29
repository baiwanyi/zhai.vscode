/**
 * AI 对话消息流容器：MessageScroller 组合（Provider 托管自动滚动、Item 以 messageId 作滚动锚点、
 * Button 自动显隐回到底部），空态交给 AiChatEmptyState 分派，末尾按瞬时状态展示进度 Marker，
 * 待确认事项挂到归属消息下、归属失效时回落到列表末尾。
 * 关键约束：末条消息作为滚动锚点，流式增长时保持贴底；本组件不处理消息内容渲染（见 AiChatMessageView）；
 * 进度行只允许出现一条 —— 准备上下文优先于压缩，两者同时成立时只展示前者，避免两行转圈并列；
 * 进度行加 role="status"，让辅助技术在状态变化时播报一次；
 * 确认卡片必须始终可见 —— 挂不上消息时宁可落在末尾，也不能让它静默消失到超时。
 */
import { useEffect, useRef } from 'react'
import { Marker, MarkerContent, MarkerIcon } from '@components/ui/marker'
import {
    MessageScroller,
    MessageScrollerButton,
    MessageScrollerContent,
    MessageScrollerItem,
    MessageScrollerProvider,
    MessageScrollerViewport,
    useMessageScroller,
} from '@components/ui/message-scroller'
import { Spinner } from '@components/ui/spinner'
import type { AiMessage, AiPermissionDecision, AiPermissionRequest, AiRuntimeInfo } from '@shared/types/aiChat'
import { AiChatConfirmCard } from './AiChatConfirmCard'
import { AiChatEmptyState } from './AiChatEmptyState'
import { AiChatMessageView } from './AiChatMessageView'
import { AiChatQuestionnaire } from './AiChatQuestionnaire'
import type { AiChatTransientNotice, Phase } from '../hooks/useAiChatSession'
import type { JSX } from 'react'

interface AiChatMessageListProps {
    messages: AiMessage[]
    lastMessageId: string | undefined
    phase: Phase
    /** 会话级瞬时状态：非 null 时在列表末尾追加对应的进度行 */
    transientNotice: AiChatTransientNotice
    /** 待确认事项：按 messageId 挂到对应气泡下，未命中则回落到列表末尾 */
    pendingApproval: AiPermissionRequest | null
    /** 提交确认决定 */
    onAnswer: (decision: AiPermissionDecision) => void
    /** 重复一条用户消息：把命令与正文回填到输入框 */
    onRepeat: (message: AiMessage) => void
    runtime: AiRuntimeInfo | null
    onLoginCodebuddy: () => void
}

/**
 * 确认事项出现时把视图拉回底部：卡片挂在发起调用的助手气泡下，
 * 用户上翻历史时它可能落在视野外，不主动滚一下就等于没提示。
 * 同一事项只滚一次 —— 依赖里的 scrollToEnd 引用不稳定，重复触发会把用户刚翻到的位置反复拽走。
 */
function ApprovalAutoScroll({ approvalId }: { approvalId: string | null }): null {
    const { scrollToEnd } = useMessageScroller()
    const scrolledIdRef = useRef<string | null>(null)

    useEffect(() => {
        if (approvalId === null || scrolledIdRef.current === approvalId) {
            return
        }
        scrolledIdRef.current = approvalId
        scrollToEnd({ behavior: 'smooth' })
    }, [approvalId, scrollToEnd])

    return null
}

export function AiChatMessageList({
    messages,
    lastMessageId,
    phase,
    transientNotice,
    pendingApproval,
    onAnswer,
    onRepeat,
    runtime,
    onLoginCodebuddy,
}: AiChatMessageListProps): JSX.Element {
    /**
     * 归属消息是否还在当前列表：切换会话或历史被裁剪后它会失效，
     * 此时把卡片挂到列表末尾 —— 没有这条回落路径，确认请求会一直无人可见直到超时。
     */
    const hasAnchor =
        pendingApproval !== null &&
        typeof pendingApproval.messageId === 'string' &&
        messages.some((message) => message.id === pendingApproval.messageId)
    /**
     * scrollPreviousItemPeek 置 0：默认 64px 会整段加进 spacer 高度，
     * 内容不足一屏时把首屏整体顶出视口（新建会话最明显）。
     * 首屏仍滚到最新（defaultScrollPosition="end"），只是不再多留那 64px 预览。
     */
    return (
        <MessageScrollerProvider defaultScrollPosition="last-anchor" scrollPreviousItemPeek={100}>
            <MessageScroller>
                <MessageScrollerViewport aria-label="对话消息" className="px-3 pb-6">
                    <MessageScrollerContent>
                        {messages.length === 0 ? (
                            <AiChatEmptyState runtime={runtime} onLoginCodebuddy={onLoginCodebuddy} />
                        ) : null}
                        {messages.map((message) => (
                            <MessageScrollerItem
                                key={message.id}
                                messageId={message.id}
                                scrollAnchor={message.id === lastMessageId}
                            >
                                <AiChatMessageView
                                    message={message}
                                    pendingApproval={pendingApproval?.messageId === message.id ? pendingApproval : null}
                                    onAnswer={onAnswer}
                                    onRepeat={onRepeat}
                                />
                            </MessageScrollerItem>
                        ))}
                        {phase === 'sending' ? (
                            <Marker role="status">
                                <MarkerIcon>
                                    <Spinner />
                                </MarkerIcon>
                                <MarkerContent>正在准备上下文…</MarkerContent>
                            </Marker>
                        ) : transientNotice === 'compacting' ? (
                            <Marker role="status">
                                <MarkerIcon>
                                    <Spinner />
                                </MarkerIcon>
                                <MarkerContent>正在压缩上下文…</MarkerContent>
                            </Marker>
                        ) : null}
                        {pendingApproval !== null && !hasAnchor ? (
                            <MessageScrollerItem
                                key={`approval-${pendingApproval.id}`}
                                messageId={`approval-${pendingApproval.id}`}
                                scrollAnchor
                            >
                                {pendingApproval.kind === 'tool' ? (
                                    <AiChatConfirmCard
                                        key={pendingApproval.id}
                                        request={pendingApproval}
                                        onSubmit={onAnswer}
                                    />
                                ) : (
                                    <AiChatQuestionnaire
                                        key={pendingApproval.id}
                                        questions={pendingApproval.questions}
                                        expiresAt={pendingApproval.expiresAt}
                                        onSubmit={onAnswer}
                                    />
                                )}
                            </MessageScrollerItem>
                        ) : null}
                    </MessageScrollerContent>
                </MessageScrollerViewport>
                <MessageScrollerButton />
            </MessageScroller>
            <ApprovalAutoScroll approvalId={pendingApproval?.id ?? null} />
        </MessageScrollerProvider>
    )
}
