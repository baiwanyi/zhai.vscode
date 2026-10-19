/**
 * AI 对话消息正文：用户输入按纯文本保留换行，助手回复经 unified/remark 管线渲染 Markdown。
 * 复用上级目录 markdown.tsx 的主题映射与 @/components/ui 的 Spinner。
 * 关键约束：空内容按状态占位（失败 / 已停止给文案，其余给加载态），不渲染空段落。
 */
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Spinner } from '@/components/ui/spinner'
import type { AiMessage } from '@/shared/types/aiChat'
import type { JSX } from 'react'
import { MARKDOWN_COMPONENTS } from '../markdown'

interface AiChatMessageBodyProps {
    message: AiMessage
}

export function AiChatMessageBody({ message }: AiChatMessageBodyProps): JSX.Element {
    if (message.content.length > 0) {
        return message.role === 'user' ? (
            <>{message.content}</>
        ) : (
            <Markdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                {message.content}
            </Markdown>
        )
    }
    return <>{message.status === 'failed' || message.status === 'cancelled' ? '（未产生内容）' : <Spinner />}</>
}
