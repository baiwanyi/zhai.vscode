/**
 * AI 对话消息渲染：MessageRow 按角色分派气泡（用户 default 右对齐、助手 ghost 通栏无气泡），
 * MessageRefs 呈现消息内引用条目（属消息内容，置于用户气泡内正文之上，不悬在消息头部），
 * MessageBody 按角色渲染正文——用户输入按纯文本保留换行，助手回复走 unified/remark 管线。
 * Markdown 逐标签映射主题令牌类名（不引 typography 插件，避免与气泡样式互相覆盖）。
 * 关键约束：空内容按状态占位（失败/已停止给文案，其余给加载 Spinner）。
 */
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Badge } from '@/components/ui/badge'
import { Bubble, BubbleContent, BubbleGroup } from '@/components/ui/bubble'
import { Message, MessageContent, MessageFooter } from '@/components/ui/message'
import { Spinner } from '@/components/ui/spinner'
import type { AiContextRef, AiMessage } from '@/shared/types/aiChat'
import type { JSX } from 'react'
import type { Components } from 'react-markdown'

/** 单条消息：引用作为消息内容的一部分置于气泡内（不悬在消息头部）；用户消息为右对齐气泡，助手回复走 Bubble ghost 通栏纯文本 */
export function MessageRow({ message }: { message: AiMessage }): JSX.Element {
    const isUser = message.role === 'user'
    const isCancelled = message.status === 'cancelled'
    return (
        <Message align={isUser ? 'end' : 'start'}>
            <MessageContent>
                <BubbleGroup className="w-full">
                    {isUser ? (
                        <Bubble variant="default">
                            <BubbleContent className="flex w-max max-w-full flex-col gap-1.5 whitespace-pre-wrap">
                                <MessageRefs refs={message.refs} />
                                <MessageBody message={message} />
                            </BubbleContent>
                        </Bubble>
                    ) : (
                        <Bubble variant="ghost" className="w-full">
                            <BubbleContent>
                                <MessageBody message={message} />
                            </BubbleContent>
                        </Bubble>
                    )}
                </BubbleGroup>
                {message.error ? <MessageFooter className="text-destructive">{message.error}</MessageFooter> : null}
                {message.error === null && (message.status === 'failed' || isCancelled) ? (
                    <MessageFooter>{isCancelled ? '已停止生成' : '生成失败'}</MessageFooter>
                ) : null}
            </MessageContent>
        </Message>
    )
}

/** 消息内引用条目：与正文同属一条对话内容，随消息一起展示（无引用时渲染为空） */
function MessageRefs({ refs }: { refs: AiContextRef[] }): JSX.Element | null {
    if (refs.length === 0) {
        return null
    }
    return (
        <div className="flex flex-wrap gap-1">
            {refs.map((ref) => (
                <Badge key={ref.id} variant="secondary" className="max-w-full font-normal" title={ref.displayPath}>
                    <span className="min-w-0 truncate">{ref.label}</span>
                </Badge>
            ))}
        </div>
    )
}

/** 消息正文：用户输入按纯文本保留换行，助手回复走 unified/remark 管线渲染 Markdown（见 markdown-one.md 第 5 节） */
function MessageBody({ message }: { message: AiMessage }): JSX.Element {
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

/** Markdown 元素到主题类名的映射：不引入 typography 插件，逐标签复用 shadcn 令牌，避免与气泡样式互相覆盖 */
const MARKDOWN_COMPONENTS: Components = {
    p: ({ children }) => <p className="mb-2 leading-relaxed last:mb-0">{children}</p>,
    strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,
    ul: ({ children }) => <ul className="mb-2 list-disc pl-4 last:mb-0">{children}</ul>,
    ol: ({ children }) => <ol className="mb-2 list-decimal pl-4 last:mb-0">{children}</ol>,
    li: ({ children }) => <li className="mb-0.5">{children}</li>,
    h1: ({ children }) => <h3 className="mb-2 font-heading text-base font-medium">{children}</h3>,
    h2: ({ children }) => <h4 className="mb-2 font-heading text-sm font-medium">{children}</h4>,
    h3: ({ children }) => <h5 className="mb-1.5 font-heading text-sm font-medium">{children}</h5>,
    blockquote: ({ children }) => (
        <blockquote className="mb-2 border-l-2 border-quote-border bg-quote-background pl-2 text-muted-foreground italic last:mb-0">
            {children}
        </blockquote>
    ),
    a: ({ children, href }) => (
        <a className="text-link underline underline-offset-2" href={href}>
            {children}
        </a>
    ),
    code: ({ children, className }) =>
        typeof className === 'string' && className.includes('language-') ? (
            <code className={className}>{children}</code>
        ) : (
            <code className="rounded bg-code-background px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
        ),
    pre: ({ children }) => (
        <pre className="mb-2 overflow-x-auto rounded-md bg-code-background p-2 text-xs last:mb-0">{children}</pre>
    ),
    hr: () => <hr className="my-2 border-border" />,
    table: ({ children }) => <table className="mb-2 w-full border-collapse text-xs last:mb-0">{children}</table>,
    th: ({ children }) => <th className="border border-border px-1.5 py-1 text-left font-medium">{children}</th>,
    td: ({ children }) => <td className="border border-border px-1.5 py-1">{children}</td>,
}
