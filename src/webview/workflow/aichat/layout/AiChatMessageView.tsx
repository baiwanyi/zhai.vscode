/**
 * AI 对话单条消息：按角色分派气泡（用户 default 右对齐、助手 ghost 通栏无气泡）。
 * 引用条目、正文与写回按钮分别由同目录独立组件渲染，本层只负责结构编排与状态分派。
 * 关键约束：写回按钮仅对可写回的助手消息渲染；错误与停止文案优先于写回入口。
 */
import { Bubble, BubbleContent, BubbleGroup } from '@/components/ui/bubble'
import { Message, MessageContent, MessageFooter } from '@/components/ui/message'
import type { AiMessage, AiWriteScope } from '@/shared/types/aiChat'
import { AiChatApplyButton } from './AiChatApplyButton'
import { AiChatMessageBody } from './AiChatMessageBody'
import { AiChatMessageRefs } from './AiChatMessageRefs'
import type { JSX } from 'react'

/** 写回入口的渲染状态：由消息列表按宿主下发的可写回集合计算后注入 */
export interface AiChatApplyAction {
    appliable: boolean
    applied: boolean
    applying: boolean
    scope: AiWriteScope | null
    onApply: () => void
}

interface AiChatMessageViewProps {
    message: AiMessage
    applyAction?: AiChatApplyAction
}

export function AiChatMessageView({ message, applyAction }: AiChatMessageViewProps): JSX.Element {
    const isUser = message.role === 'user'
    const isCancelled = message.status === 'cancelled'
    return (
        <Message align={isUser ? 'end' : 'start'}>
            <MessageContent>
                <BubbleGroup className="w-full">
                    {isUser ? (
                        <Bubble variant="default">
                            <BubbleContent className="flex w-max max-w-full flex-col gap-1.5 whitespace-pre-wrap">
                                <AiChatMessageRefs refs={message.refs} />
                                <AiChatMessageBody message={message} />
                            </BubbleContent>
                        </Bubble>
                    ) : (
                        <Bubble variant="ghost" className="w-full">
                            <BubbleContent>
                                <AiChatMessageBody message={message} />
                            </BubbleContent>
                        </Bubble>
                    )}
                </BubbleGroup>
                {message.error ? <MessageFooter className="text-destructive">{message.error}</MessageFooter> : null}
                {message.error === null && (message.status === 'failed' || isCancelled) ? (
                    <MessageFooter>{isCancelled ? '已停止生成' : '生成失败'}</MessageFooter>
                ) : null}
                {applyAction?.appliable ? (
                    <MessageFooter className="justify-end">
                        <AiChatApplyButton
                            scope={applyAction.scope}
                            applied={applyAction.applied}
                            applying={applyAction.applying}
                            onApply={applyAction.onApply}
                        />
                    </MessageFooter>
                ) : null}
            </MessageContent>
        </Message>
    )
}
