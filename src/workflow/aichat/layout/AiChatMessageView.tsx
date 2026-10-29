/**
 * AI 对话单条消息：按角色分派气泡（用户 default 右对齐、助手 ghost 通栏无气泡）。
 * 正文（含用户消息首行的命令与引用徽章）与统计工具栏分别由同目录独立组件渲染，
 * 本层只负责结构编排与状态分派。
 * 关键约束：错误与停止文案优先于工具栏；工具栏只在助手消息生成落定
 * （完成 / 失败 / 停止）且有正文时出现，流式中不出现。
 */
import { Bubble, BubbleContent, BubbleGroup } from '@components/ui/bubble'
import { Message, MessageContent, MessageFooter } from '@components/ui/message'
import type { AiMessage } from '@shared/types/aiChat'
import { AiChatMessageActions } from './AiChatMessageActions'
import { AiChatMessageBody } from './AiChatMessageBody'
import type { JSX } from 'react'

interface AiChatMessageViewProps {
    message: AiMessage
}

export function AiChatMessageView({ message }: AiChatMessageViewProps): JSX.Element {
    const isUser = message.role === 'user'
    const isCancelled = message.status === 'cancelled'
    /** 生成已落定：流式过程中不展示工具栏，避免用量与耗时是半成品 */
    const isSettled = message.status === 'completed' || message.status === 'failed' || isCancelled
    return (
        <Message align={isUser ? 'end' : 'start'}>
            <MessageContent>
                <BubbleGroup className="w-full">
                    {isUser ? (
                        <Bubble variant="default">
                            <BubbleContent className="flex w-max max-w-full flex-col gap-1.5 whitespace-pre-wrap">
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
                {isUser || !isSettled || message.content.length === 0 ? null : (
                    <MessageFooter>
                        <AiChatMessageActions message={message} />
                    </MessageFooter>
                )}
            </MessageContent>
        </Message>
    )
}
