/**
 * AI 对话页：MessageScroller 托管消息流滚动、Message + Bubble 呈现消息，流式正文经宿主 stream 消息增量渲染。
 * 设计源：docs/modules/ai-chat.md 第 4.2 节对话状态机；交互约束：生成期间禁用发送并显示停止按钮。
 */
import { Bot, Plus, Send, Square, UserRound } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Bubble, BubbleContent, BubbleGroup } from '@/components/ui/bubble'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Message, MessageAvatar, MessageContent, MessageFooter, MessageHeader } from '@/components/ui/message'
import {
    MessageScroller,
    MessageScrollerButton,
    MessageScrollerContent,
    MessageScrollerItem,
    MessageScrollerProvider,
    MessageScrollerViewport,
} from '@/components/ui/message-scroller'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import type { AiMessage, AiRuntimeInfo, AiSendResult, AiSessionSnapshot } from '@/shared/types/aiChat'
import { onState, onStream, request } from './bridge'
import type { JSX } from 'react'

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
                setSession((previous) => patchMessage(previous, messageId, (item) => ({
                    ...item,
                    content: message.content ?? item.content,
                    status: message.status ?? 'completed',
                    error: message.error ?? null,
                })))
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

    return (
        <div className="flex h-screen flex-col">
            <header className="flex items-center justify-between gap-2 border-b px-3 py-2">
                <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">{session?.conversation.title ?? 'AI 对话'}</span>
                    <span className="truncate text-xs text-muted-foreground">
                        {runtime
                            ? `${runtime.model} · 今日 ${formatTokens(runtime.usedTokensToday)} / ${formatTokens(runtime.dailyTokenBudget)} tokens`
                            : '正在读取配置…'}
                    </span>
                </div>
                <Button size="icon-sm" variant="ghost" title="新建会话" onClick={() => void startNewSession()}>
                    <Plus />
                </Button>
            </header>

            <div className="min-h-0 flex-1">
                <MessageScrollerProvider defaultScrollPosition="end">
                    <MessageScroller>
                        <MessageScrollerViewport aria-label="对话消息">
                            <MessageScrollerContent className="gap-4 p-3">
                                {runtime && !hasApiKey ? (
                                    <MessageScrollerItem messageId="api-key-guide">
                                        <ApiKeyGuide onSetup={() => void runHostCommand('zhai.ai.setApiKey')} />
                                    </MessageScrollerItem>
                                ) : null}
                                {messages.length === 0 ? (
                                    <MessageScrollerItem messageId="empty-hint">
                                        <p className="text-sm text-muted-foreground">
                                            用 Enter 发送消息，Shift + Enter 换行；会话与消息会在窗口重启后恢复。
                                        </p>
                                    </MessageScrollerItem>
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
                                    <MessageScrollerItem messageId="preparing">
                                        <span className="flex items-center gap-2 text-xs text-muted-foreground">
                                            <Spinner />
                                            正在准备上下文…
                                        </span>
                                    </MessageScrollerItem>
                                ) : null}
                            </MessageScrollerContent>
                        </MessageScrollerViewport>
                        <MessageScrollerButton />
                    </MessageScroller>
                </MessageScrollerProvider>
            </div>

            <footer className="flex flex-col gap-2 border-t p-3">
                {error ? <p className="text-xs text-destructive">{error}</p> : null}
                <Textarea
                    value={input}
                    className="max-h-40 min-h-16"
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
                <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                        {isGenerating ? '正在生成，可随时停止' : 'Enter 发送 · Shift + Enter 换行'}
                    </span>
                    {isGenerating ? (
                        <Button size="sm" variant="outline" onClick={() => void stop()}>
                            <Square data-icon="inline-start" />
                            停止
                        </Button>
                    ) : (
                        <Button
                            size="sm"
                            disabled={!hasApiKey || phase !== 'idle' || input.trim().length === 0}
                            onClick={() => void send()}
                        >
                            <Send data-icon="inline-start" />
                            发送
                        </Button>
                    )}
                </div>
            </footer>
        </div>
    )
}

/** 单条消息：Message 负责头像/头部/内容布局，Bubble 负责气泡样式，对齐随 Message 的 align 联动 */
function MessageRow({ message }: { message: AiMessage }): JSX.Element {
    const isUser = message.role === 'user'
    return (
        <Message align={isUser ? 'end' : 'start'}>
            <MessageAvatar>{isUser ? <UserRound className="size-4" /> : <Bot className="size-4" />}</MessageAvatar>
            <MessageContent>
                <MessageHeader className="gap-1">
                    {isUser ? '你' : '助手'}
                    {message.status === 'failed' ? <span className="text-destructive">· 失败</span> : null}
                    {message.status === 'cancelled' ? <span>· 已停止</span> : null}
                </MessageHeader>
                <BubbleGroup>
                    <Bubble variant={isUser ? 'default' : 'muted'}>
                        <BubbleContent className="whitespace-pre-wrap">{renderContent(message)}</BubbleContent>
                    </Bubble>
                </BubbleGroup>
                {message.error ? <MessageFooter className="text-destructive">{message.error}</MessageFooter> : null}
            </MessageContent>
        </Message>
    )
}

/** 无 Key 引导（AC-6）：以卡片替代异常栈，直接给出配置入口 */
function ApiKeyGuide({ onSetup }: { onSetup: () => void }): JSX.Element {
    return (
        <Card size="sm">
            <CardHeader>
                <CardTitle>先配置 DeepSeek API Key</CardTitle>
                <CardDescription>
                    密钥保存在系统密钥库（SecretStorage），不会写入设置文件与仓库，日志中仅显示末 4 位。
                </CardDescription>
            </CardHeader>
            <CardContent>
                <Button size="sm" onClick={onSetup}>
                    设置 API Key
                </Button>
            </CardContent>
        </Card>
    )
}

function renderContent(message: AiMessage): JSX.Element | string {
    if (message.content.length > 0) {
        return message.content
    }
    return message.status === 'failed' || message.status === 'cancelled' ? '（未产生内容）' : <Spinner />
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
