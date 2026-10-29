/**
 * AI 对话消息正文：用户消息交给 AiChatMessageUserBody（命令徽章 + 补充文本），助手回复经 unified/remark 渲染 Markdown，
 * 思维链由同目录 AiChatMessageReasoning 以可折叠轨迹呈现在正文上方。
 * 复用上级目录 markdown.tsx 的主题映射、同目录用户正文与思考过程组件、@components/ui 的 Spinner。
 * 关键约束：有思维链时优先展示思考过程——等待首字期间它就是主体，正文出现后自动收起为一行；
 * 其余空内容按状态占位（失败 / 已停止给文案，待首字给加载态，已完成空回复不渲染），不渲染空段落；
 * 用户消息的命令拆分不改变落库内容，思维链只属于助手消息。
 */
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Spinner } from '@components/ui/spinner'
import type { AiMessage } from '@shared/types/aiChat'
import { AiChatMessageReasoning } from './AiChatMessageReasoning'
import { AiChatMessageUserBody } from './AiChatMessageUserBody'
import type { JSX } from 'react'
import { MARKDOWN_COMPONENTS } from '../markdown'

interface AiChatMessageBodyProps {
    message: AiMessage
}

export function AiChatMessageBody({ message }: AiChatMessageBodyProps): JSX.Element | null {
    const reasoning = message.reasoning ?? ''
    const hasReasoning = message.role === 'assistant' && reasoning.length > 0
    const isStreaming = message.status === 'pending' || message.status === 'streaming'
    /** 思考块：正文为空时单独占位，正文出现后折叠在正文上方 */
    const reasoningBlock = hasReasoning ? (
        <AiChatMessageReasoning
            reasoning={reasoning}
            isStreaming={isStreaming}
            hasContent={message.content.length > 0}
        />
    ) : null

    if (message.content.length > 0) {
        return (
            <>
                {reasoningBlock}
                {message.role === 'user' ? (
                    <AiChatMessageUserBody message={message} />
                ) : (
                    <Markdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                        {message.content}
                    </Markdown>
                )}
            </>
        )
    }
    if (reasoningBlock !== null) {
        return reasoningBlock
    }
    if (message.status === 'failed' || message.status === 'cancelled') {
        return <>（未产生内容）</>
    }
    // 只有待首字与流式中才是加载态：已完成的空回复不再转圈，交由调用方决定是否展示
    return isStreaming ? <Spinner /> : null
}
