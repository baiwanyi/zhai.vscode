/**
 * AI 对话页：MessageScroller 托管消息流（自动滚动 + 回到底部按钮），Message + Bubble 呈现消息，
 * 空态用 Empty、输入区用 InputGroup 组合，与 message-scroller 的官方界面模式一致；流式正文经宿主 stream 消息增量渲染。
 * 设计源：docs/modules/ai-chat.md 第 4.2 节对话状态机；交互约束：生成期间禁用发送并显示停止按钮。
 */
import { cn } from 'cn'
import { ArrowUp, Bot, KeyRound, Settings, Sparkles, Square, SquarePen, UserRound } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Bubble, BubbleContent, BubbleGroup } from '@/components/ui/bubble'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from '@/components/ui/input-group'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker'
import { Message, MessageAvatar, MessageContent, MessageFooter, MessageHeader } from '@/components/ui/message'
import {
    MessageScroller,
    MessageScrollerButton,
    MessageScrollerContent,
    MessageScrollerItem,
    MessageScrollerProvider,
    MessageScrollerViewport,
} from '@/components/ui/message-scroller'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import type { AiMessage, AiRuntimeInfo, AiSendResult, AiSessionSnapshot } from '@/shared/types/aiChat'
import { onState, onStream, request } from './bridge'
import type { JSX } from 'react'
import type { Components } from 'react-markdown'

/** 视图阶段：idle 空闲、sending 已提交待首字、streaming 正在逐字生成 */
type Phase = 'idle' | 'sending' | 'streaming'

export function AiChat(): JSX.Element {
    const [session, setSession] = useState<AiSessionSnapshot | null>(null)
    const [runtime, setRuntime] = useState<AiRuntimeInfo | null>(null)
    const [input, setInput] = useState('')
    const [phase, setPhase] = useState<Phase>('idle')
    const [error, setError] = useState<string | null>(null)
    /** 正在流式填充的消息 id，避免每次增量都触发状态结构变更 */
    const streamingMessageIdRef = useRef<string | null>(null)

    const loadSession = useCallback(async (): Promise<void> => {
        try {
            setSession(await request<AiSessionSnapshot>('ai/session'))
            setError(null)
        } catch (cause) {
            setError(toErrorText(cause))
        }
    }, [])

    const loadRuntime = useCallback(async (): Promise<void> => {
        try {
            setRuntime(await request<AiRuntimeInfo>('ai/runtime'))
        } catch (cause) {
            setError(toErrorText(cause))
        }
    }, [])

    useEffect(() => {
        void loadSession()
        void loadRuntime()
    }, [loadSession, loadRuntime])

    // 密钥增删后由宿主广播，前端刷新运行时信息以解除/进入引导态
    useEffect(() => {
        return onState((message) => {
            if (message.channel === 'ai') {
                void loadRuntime()
            }
        })
    }, [loadRuntime])

    // 流式增量：按 reqId 找到发起时的助手消息并就地追加
    useEffect(() => {
        return onStream((message) => {
            const messageId = streamingMessageIdRef.current
            if (!messageId) {
                return
            }
            if (message.done) {
                streamingMessageIdRef.current = null
                setPhase('idle')
                setSession((previous) =>
                    patchMessage(previous, messageId, (item) => ({
                        ...item,
                        content: message.content ?? item.content,
                        status: message.status ?? 'completed',
                        error: message.error ?? null,
                    })),
                )
                if (message.error) {
                    setError(message.error)
                }
                return
            }
            if (message.delta.length === 0) {
                return
            }
            setSession((previous) =>
                patchMessage(previous, messageId, (item) => ({ ...item, content: item.content + message.delta })),
            )
        })
    }, [])

    const send = useCallback(async (): Promise<void> => {
        const content = input.trim()
        if (content.length === 0 || !session || phase !== 'idle') {
            return
        }
        setPhase('sending')
        setError(null)
        try {
            const result = await request<AiSendResult>('ai/send', {
                conversationId: session.conversation.id,
                content,
            })
            streamingMessageIdRef.current = result.assistantMessage.id
            setSession((previous) =>
                previous
                    ? {
                          ...previous,
                          messages: [...previous.messages, result.userMessage, result.assistantMessage],
                      }
                    : previous,
            )
            setInput('')
            setPhase('streaming')
        } catch (cause) {
            setError(toErrorText(cause))
            setPhase('idle')
        }
    }, [input, phase, session])

    const stop = useCallback(async (): Promise<void> => {
        try {
            await request('ai/abort')
        } catch (cause) {
            setError(toErrorText(cause))
        }
    }, [])

    const startNewSession = useCallback(async (): Promise<void> => {
        try {
            setSession(await request<AiSessionSnapshot>('ai/newSession'))
            setInput('')
            setError(null)
        } catch (cause) {
            setError(toErrorText(cause))
        }
    }, [])

    /** 触发白名单内的宿主命令（设置密钥、打开设置等） */
    const runHostCommand = useCallback(async (command: string): Promise<void> => {
        try {
            await request('host/command', command)
        } catch (cause) {
            setError(toErrorText(cause))
        }
    }, [])

    const messages = session?.messages ?? []
    /** 末条消息作为滚动锚点，流式增长时由 MessageScroller 保持贴底 */
    const lastMessageId = messages[messages.length - 1]?.id
    const hasApiKey = runtime?.hasApiKey === true
    const isGenerating = phase === 'streaming'
    const isEmpty = messages.length === 0

    return (
        <div className="flex h-screen flex-col">
            <header className="flex items-start justify-between gap-2 px-3 py-2.5">
                <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium">{session?.conversation.title ?? 'AI 对话'}</span>
                    <span className="truncate text-xs text-muted-foreground">
                        {runtime
                            ? `${runtime.model} · 今日 ${formatTokens(runtime.usedTokensToday)} / ${formatTokens(runtime.dailyTokenBudget)} tokens`
                            : '正在读取配置…'}
                    </span>
                </div>
                <Button
                    size="icon-sm"
                    variant="secondary"
                    className="rounded-full"
                    title="新建会话"
                    onClick={() => void startNewSession()}
                >
                    <SquarePen />
                </Button>
            </header>
            <Separator />

            <div className="min-h-0 flex-1">
                <MessageScrollerProvider defaultScrollPosition="end">
                    <MessageScroller>
                        <MessageScrollerViewport aria-label="对话消息">
                            <MessageScrollerContent className="gap-4 p-3">
                                {isEmpty ? (
                                    runtime === null ? (
                                        <LoadingState />
                                    ) : hasApiKey ? (
                                        <WelcomeState />
                                    ) : (
                                        <ApiKeyState onSetup={() => void runHostCommand('zhai.ai.setApiKey')} />
                                    )
                                ) : null}
                                {messages.map((message) => (
                                    <MessageScrollerItem
                                        key={message.id}
                                        messageId={message.id}
                                        scrollAnchor={message.id === lastMessageId}
                                    >
                                        <MessageRow message={message} />
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
            </div>

            <Separator />
            <footer className="flex flex-col gap-2 p-3">
                <InputGroup>
                    <InputGroupTextarea
                        value={input}
                        className="max-h-40"
                        placeholder={hasApiKey ? '输入消息…' : '请先设置 DeepSeek API Key'}
                        disabled={!hasApiKey || isGenerating}
                        onChange={(event) => setInput(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.shiftKey) {
                                event.preventDefault()
                                void send()
                            }
                        }}
                    />
                    <InputGroupAddon align="block-end" className="justify-between">
                        <InputGroupButton
                            size="icon-sm"
                            variant="ghost"
                            className="rounded-full"
                            title="插件设置"
                            onClick={() => void runHostCommand('zhai.openSettings')}
                        >
                            <Settings />
                        </InputGroupButton>
                        {isGenerating ? (
                            <InputGroupButton
                                size="icon-sm"
                                variant="outline"
                                className="rounded-full"
                                title="停止生成"
                                onClick={() => void stop()}
                            >
                                <Square />
                            </InputGroupButton>
                        ) : (
                            <InputGroupButton
                                size="icon-sm"
                                variant="default"
                                className="rounded-full"
                                title="发送"
                                disabled={!hasApiKey || phase !== 'idle' || input.trim().length === 0}
                                onClick={() => void send()}
                            >
                                <ArrowUp />
                            </InputGroupButton>
                        )}
                    </InputGroupAddon>
                </InputGroup>
                <p
                    className={cn(
                        'text-center text-xs',
                        error ? 'text-destructive' : 'text-muted-foreground',
                    )}
                >
                    {error ??
                        (isGenerating ? '正在生成，可随时停止' : 'Enter 发送 · Shift + Enter 换行 · Ctrl+Shift+L 聚焦')}
                </p>
            </footer>
        </div>
    )
}

/** 单条消息：Message 负责头像/头部/内容布局，Bubble 负责气泡样式，对齐随 Message 的 align 联动 */
function MessageRow({ message }: { message: AiMessage }): JSX.Element {
    const isUser = message.role === 'user'
    return (
        <Message align={isUser ? 'end' : 'start'}>
            <MessageAvatar className="size-8 self-start group-has-data-[slot=message-footer]/message:translate-y-0">
                {isUser ? <UserRound className="size-4" /> : <Bot className="size-4" />}
            </MessageAvatar>
            <MessageContent>
                <MessageHeader className="gap-1">
                    {isUser ? '你' : '助手'}
                    {message.status === 'failed' ? <span className="text-destructive">· 失败</span> : null}
                    {message.status === 'cancelled' ? <span>· 已停止</span> : null}
                </MessageHeader>
                <BubbleGroup className="w-full">
                    <Bubble variant={isUser ? 'default' : 'muted'}>
                        <BubbleContent className={cn('w-max max-w-full', isUser && 'whitespace-pre-wrap')}>
                            <MessageBody message={message} />
                        </BubbleContent>
                    </Bubble>
                </BubbleGroup>
                {message.error ? <MessageFooter className="text-destructive">{message.error}</MessageFooter> : null}
            </MessageContent>
        </Message>
    )
}

/** 欢迎态：无消息时的居中引导（Empty 组件的标准用法） */
function WelcomeState(): JSX.Element {
    return (
        <Empty>
            <EmptyHeader>
                <EmptyMedia variant="icon" className="size-12 rounded-2xl">
                    <Sparkles className="size-5" />
                </EmptyMedia>
                <EmptyTitle>开始新的对话</EmptyTitle>
                <EmptyDescription>
                    输入问题后按 Enter 发送，Shift + Enter 换行；会话与消息会在窗口重启后自动恢复。
                </EmptyDescription>
            </EmptyHeader>
        </Empty>
    )
}

/** 无 Key 引导（AC-6）：以空态卡片替代异常栈，直接给出配置入口 */
function ApiKeyState({ onSetup }: { onSetup: () => void }): JSX.Element {
    return (
        <Empty>
            <EmptyHeader>
                <EmptyMedia variant="icon" className="size-12 rounded-2xl">
                    <KeyRound className="size-5" />
                </EmptyMedia>
                <EmptyTitle>先配置 DeepSeek API Key</EmptyTitle>
                <EmptyDescription>
                    密钥保存在系统密钥库（SecretStorage），不会写入设置文件与仓库，日志中仅显示末 4 位。
                </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
                <Button size="sm" onClick={onSetup}>
                    <KeyRound data-icon="inline-start" />
                    设置 API Key
                </Button>
            </EmptyContent>
        </Empty>
    )
}

/** 运行时信息加载中的占位空态 */
function LoadingState(): JSX.Element {
    return (
        <Empty>
            <EmptyHeader>
                <EmptyMedia variant="icon" className="size-12 rounded-2xl">
                    <Spinner />
                </EmptyMedia>
                <EmptyTitle>正在读取会话</EmptyTitle>
            </EmptyHeader>
        </Empty>
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

/** 就地替换指定消息，保持其余引用不变 */
function patchMessage(
    session: AiSessionSnapshot | null,
    messageId: string,
    patch: (message: AiMessage) => AiMessage,
): AiSessionSnapshot | null {
    if (!session) {
        return session
    }
    return {
        ...session,
        messages: session.messages.map((item) => (item.id === messageId ? patch(item) : item)),
    }
}

/** token 数量紧凑展示：过千折算 k，过百万折算 M */
function formatTokens(value: number): string {
    if (value >= 1_000_000) {
        return `${(value / 1_000_000).toFixed(1)}M`
    }
    if (value >= 1_000) {
        return `${(value / 1_000).toFixed(1)}k`
    }
    return String(value)
}

function toErrorText(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause)
}
