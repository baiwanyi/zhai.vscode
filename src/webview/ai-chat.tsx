/**
 * AI 对话页：MessageScroller 托管消息流（自动滚动 + 回到底部按钮），Message + Bubble 呈现消息，
 * 空态用 Empty、输入区用 InputGroup 组合，与 message-scroller 的官方界面模式一致；流式正文经宿主 stream 消息增量渲染。
 * 消息样式参考 Copilot / CodeBuddy：无头像与角色标签，用户消息为右对齐气泡，助手回复走 Bubble ghost 变体通栏纯文本。
 * 「添加到宅对话」的待发送上下文以 Attachment 清单呈现在输入区上方，已发送的引用作为消息内容的一部分随消息展示。
 * 顶部工具条提供「历史对话」浮层（对齐 Copilot：标题 + 相对时间，hover 显示删除），可切换与删除会话。
 * 设计源：docs/modules/ai-chat.md 第 4.2 节对话状态机；交互约束：生成期间禁用发送并显示停止按钮。
 */
import { cn } from 'cn'
import {
    ArrowUp,
    FileText,
    History,
    KeyRound,
    Settings,
    Sparkles,
    Square,
    SquarePen,
    TextSelect,
    Trash2,
    X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
    Attachment,
    AttachmentAction,
    AttachmentActions,
    AttachmentContent,
    AttachmentDescription,
    AttachmentGroup,
    AttachmentMedia,
    AttachmentTitle,
} from '@/components/ui/attachment'
import { Badge } from '@/components/ui/badge'
import { Bubble, BubbleContent, BubbleGroup } from '@/components/ui/bubble'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from '@/components/ui/input-group'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker'
import { Message, MessageContent, MessageFooter } from '@/components/ui/message'
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
import type {
    AiContextRef,
    AiConversationSummary,
    AiMessage,
    AiRuntimeInfo,
    AiSendResult,
    AiSessionSnapshot,
} from '@/shared/types/aiChat'
import { onState, onStream, request } from './bridge'
import type { JSX } from 'react'
import type { Components } from 'react-markdown'

/** 视图阶段：idle 空闲、sending 已提交待首字、streaming 正在逐字生成 */
type Phase = 'idle' | 'sending' | 'streaming'

export function AiChat(): JSX.Element {
    const [session, setSession] = useState<AiSessionSnapshot | null>(null)
    const [runtime, setRuntime] = useState<AiRuntimeInfo | null>(null)
    const [contexts, setContexts] = useState<AiContextRef[]>([])
    const [sessions, setSessions] = useState<AiConversationSummary[]>([])
    const [input, setInput] = useState('')
    const [phase, setPhase] = useState<Phase>('idle')
    const [error, setError] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)
    /** 正在流式填充的消息 id，避免每次增量都触发状态结构变更 */
    const streamingMessageIdRef = useRef<string | null>(null)

    const loadSession = useCallback(async (): Promise<void> => {
        try {
            const snapshot = await request<AiSessionSnapshot>('ai/session')
            setSession(snapshot)
            setContexts(snapshot.contexts)
            setError(null)
        } catch (cause) {
            setError(toErrorText(cause))
        }
    }, [])

    const loadContexts = useCallback(async (): Promise<void> => {
        try {
            setContexts(await request<AiContextRef[]>('ai/context'))
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

    // 密钥增删与上下文变更由宿主广播，按 kind 刷新对应数据
    useEffect(() => {
        return onState((message) => {
            if (message.channel !== 'ai') {
                return
            }
            const kind = readAiStateKind(message.payload)
            if (kind === 'runtime') {
                void loadRuntime()
            }
            if (kind === 'context') {
                void loadContexts()
            }
        })
    }, [loadContexts, loadRuntime])

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
        setNotice(null)
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
            // 引用已随消息提交并落库，待发送清单即时清空
            setContexts([])
            if (result.skippedContexts.length > 0) {
                setNotice(`已跳过失效引用：${result.skippedContexts.join('、')}`)
            }
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
            const snapshot = await request<AiSessionSnapshot>('ai/newSession')
            setSession(snapshot)
            setContexts(snapshot.contexts)
            setInput('')
            setError(null)
            setNotice(null)
        } catch (cause) {
            setError(toErrorText(cause))
        }
    }, [])

    const loadSessions = useCallback(async (): Promise<void> => {
        try {
            setSessions(await request<AiConversationSummary[]>('ai/sessions'))
        } catch (cause) {
            setError(toErrorText(cause))
        }
    }, [])

    /** 切换到历史会话：生成中先停止再切换，避免增量写回已切走的会话；输入框内容保持不动 */
    const switchSession = useCallback(
        async (conversationId: string): Promise<void> => {
            if (session?.conversation.id === conversationId) {
                return
            }
            try {
                if (phase !== 'idle') {
                    await request('ai/abort')
                }
                const snapshot = await request<AiSessionSnapshot>('ai/switchSession', { conversationId })
                streamingMessageIdRef.current = null
                setSession(snapshot)
                setContexts(snapshot.contexts)
                setPhase('idle')
                setError(null)
                setNotice(null)
            } catch (cause) {
                setError(toErrorText(cause))
            }
        },
        [phase, session],
    )

    /** 删除历史会话：删掉的是当前会话时由宿主切到最近会话（无则新建），随后重新加载快照 */
    const deleteSession = useCallback(
        async (conversationId: string): Promise<void> => {
            const isActive = session?.conversation.id === conversationId
            try {
                await request('ai/deleteSession', { conversationId })
                if (isActive) {
                    streamingMessageIdRef.current = null
                    setPhase('idle')
                    const snapshot = await request<AiSessionSnapshot>('ai/session')
                    setSession(snapshot)
                    setContexts(snapshot.contexts)
                    setError(null)
                    setNotice(null)
                }
                await loadSessions()
            } catch (cause) {
                setError(toErrorText(cause))
            }
        },
        [loadSessions, session],
    )

    /** 触发白名单内的宿主命令（设置密钥、打开设置等） */
    const runHostCommand = useCallback(async (command: string): Promise<void> => {
        try {
            await request('host/command', command)
        } catch (cause) {
            setError(toErrorText(cause))
        }
    }, [])

    /** 移除单条上下文引用：只回传宿主生成的 id */
    const removeContext = useCallback(async (id: string): Promise<void> => {
        try {
            setContexts(await request<AiContextRef[]>('ai/context/remove', { id }))
            setNotice(null)
        } catch (cause) {
            setError(toErrorText(cause))
        }
    }, [])

    const clearContexts = useCallback(async (): Promise<void> => {
        try {
            setContexts(await request<AiContextRef[]>('ai/context/clear'))
            setNotice(null)
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
                <div className="flex shrink-0 items-center gap-1">
                    <DropdownMenu
                        onOpenChange={(isOpen) => {
                            if (isOpen) {
                                void loadSessions()
                            }
                        }}
                    >
                        <DropdownMenuTrigger asChild>
                            <Button
                                size="icon-sm"
                                variant="ghost"
                                className="rounded-full"
                                title="历史对话"
                                aria-label="历史对话"
                            >
                                <History />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-72">
                            <DropdownMenuLabel>历史对话</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            {sessions.length === 0 ? (
                                <DropdownMenuItem disabled>暂无历史对话</DropdownMenuItem>
                            ) : (
                                <DropdownMenuGroup>
                                    {sessions.map((item) => (
                                        <HistoryItem
                                            key={item.id}
                                            session={item}
                                            isActive={item.id === session?.conversation.id}
                                            onSelect={() => void switchSession(item.id)}
                                            onDelete={() => void deleteSession(item.id)}
                                        />
                                    ))}
                                </DropdownMenuGroup>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <Button
                        size="icon-sm"
                        variant="secondary"
                        className="rounded-full"
                        title="新建会话"
                        onClick={() => void startNewSession()}
                    >
                        <SquarePen />
                    </Button>
                </div>
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
                {contexts.length > 0 ? (
                    <ContextList
                        contexts={contexts}
                        onRemove={(id) => void removeContext(id)}
                        onClear={() => void clearContexts()}
                    />
                ) : null}
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
                <p className={cn('text-center text-xs', error ? 'text-destructive' : 'text-muted-foreground')}>
                    {error ??
                        notice ??
                        (isGenerating ? '正在生成，可随时停止' : 'Enter 发送 · Shift + Enter 换行 · Ctrl+Shift+L 聚焦')}
                </p>
            </footer>
        </div>
    )
}

interface ContextListProps {
    contexts: AiContextRef[]
    onRemove: (id: string) => void
    onClear: () => void
}

/** 待发送上下文清单：Attachment 呈现标签与体积，支持单条移除与一键清空 */
function ContextList({ contexts, onRemove, onClear }: ContextListProps): JSX.Element {
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">上下文 {contexts.length} 项</span>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={onClear}>
                    清空
                </Button>
            </div>
            <AttachmentGroup>
                {contexts.map((context) => (
                    <Attachment key={context.id} size="xs">
                        <AttachmentMedia>
                            {context.kind === 'selection' ? <TextSelect /> : <FileText />}
                        </AttachmentMedia>
                        <AttachmentContent>
                            <AttachmentTitle title={context.displayPath}>{context.label}</AttachmentTitle>
                            <AttachmentDescription>{describeContext(context)}</AttachmentDescription>
                        </AttachmentContent>
                        <AttachmentActions>
                            <AttachmentAction title="移除该引用" onClick={() => onRemove(context.id)}>
                                <X />
                            </AttachmentAction>
                        </AttachmentActions>
                    </Attachment>
                ))}
            </AttachmentGroup>
        </div>
    )
}

/** 单条消息：引用作为消息内容的一部分置于气泡内（不悬在消息头部）；用户消息为右对齐气泡，助手回复走 Bubble ghost 通栏纯文本 */
function MessageRow({ message }: { message: AiMessage }): JSX.Element {
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

interface HistoryItemProps {
    session: AiConversationSummary
    isActive: boolean
    onSelect: () => void
    onDelete: () => void
}

/** 历史会话条目（对齐 Copilot）：标题 + 相对时间，hover 时用删除按钮顶替时间位置，避免行宽跳动 */
function HistoryItem({ session, isActive, onSelect, onDelete }: HistoryItemProps): JSX.Element {
    return (
        <DropdownMenuItem onSelect={onSelect} className="group/history gap-2">
            <span className={cn('min-w-0 flex-1 truncate', isActive && 'font-medium')}>{session.title}</span>
            <span className="grid shrink-0 place-items-center">
                <span className="col-start-1 row-start-1 text-xs text-muted-foreground group-hover/history:opacity-0">
                    {formatRelativeTime(session.updatedAt)}
                </span>
                <Button
                    size="icon-xs"
                    variant="ghost"
                    className="col-start-1 row-start-1 opacity-0 group-hover/history:opacity-100"
                    title="删除会话"
                    aria-label="删除会话"
                    onClick={(event) => {
                        event.stopPropagation()
                        onDelete()
                    }}
                >
                    <Trash2 />
                </Button>
            </span>
        </DropdownMenuItem>
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
                    输入问题后按 Enter 发送，Shift + Enter
                    换行；在编辑器中右键「添加到宅对话」可把文件或选中行加入上下文。
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

/** 相对时间格式化器（原生 Intl，不引日期库） */
const RELATIVE_TIME_FORMATTER = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' })

/** 会话时间的展示：7 天内用相对时间，更早回退本地日期 */
function formatRelativeTime(iso: string): string {
    const time = new Date(iso).getTime()
    if (Number.isNaN(time)) {
        return ''
    }
    const minutes = Math.round((time - Date.now()) / 60_000)
    if (Math.abs(minutes) < 60) {
        return RELATIVE_TIME_FORMATTER.format(minutes, 'minute')
    }
    const hours = Math.round(minutes / 60)
    if (Math.abs(hours) < 24) {
        return RELATIVE_TIME_FORMATTER.format(hours, 'hour')
    }
    const days = Math.round(hours / 24)
    if (Math.abs(days) < 7) {
        return RELATIVE_TIME_FORMATTER.format(days, 'day')
    }
    return new Date(iso).toLocaleDateString('zh-CN')
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

/** 引用体积描述：过千折算 k，被截断时追加标注 */
function describeContext(ref: AiContextRef): string {
    const size = ref.charCount >= 1000 ? `${(ref.charCount / 1000).toFixed(1)}k 字` : `${ref.charCount} 字`
    return ref.isTruncated ? `${size} · 已截断` : size
}

/** 收窄宿主 state 广播的载荷：仅识别 ai 通道的两类通知 */
function readAiStateKind(payload: unknown): 'runtime' | 'context' | null {
    if (typeof payload !== 'object' || payload === null) {
        return null
    }
    const kind = (payload as { kind?: unknown }).kind
    return kind === 'runtime' || kind === 'context' ? kind : null
}
