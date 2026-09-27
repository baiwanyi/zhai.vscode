/**
 * AI 对话页：MessageScroller 托管消息流（自动滚动 + 回到底部按钮），Message + Bubble 呈现消息，
 * 空态用 Empty、输入区用 InputGroup 组合，与 message-scroller 的官方界面模式一致；流式正文经宿主 stream 消息增量渲染。
 * 消息样式参考 Copilot / CodeBuddy：无头像与角色标签，用户消息为右对齐气泡，助手回复走 Bubble ghost 变体通栏纯文本。
 * 「添加到宅对话」的待发送上下文以 Attachment 清单呈现在输入区上方，已发送的引用作为消息内容的一部分随消息展示。
 * 顶部工具条提供「历史对话」浮层（对齐 Copilot：标题 + 相对时间，hover 显示删除），可切换与删除会话。
 * 会话 / 上下文 / 运行时 / 历史 / 宿主命令操作拆分至 hooks/，消息渲染拆分至 layout/，Markdown 映射与纯函数拆分至同目录模块。
 * 设计源：docs/modules/ai-chat.md 第 4.2 节对话状态机；交互约束：生成期间禁用发送并显示停止按钮。
 */
import { cn } from 'cn'
import { ArrowUp, History, Settings, Square, SquarePen } from 'lucide-react'
import { useEffect } from 'react'
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
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from '@/components/ui/input-group'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker'
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
import { useAiChatCommands } from './hooks/useAiChatCommands'
import { useAiChatContexts } from './hooks/useAiChatContexts'
import { useAiChatHistory } from './hooks/useAiChatHistory'
import { useAiChatRuntime } from './hooks/useAiChatRuntime'
import { useAiChatSession } from './hooks/useAiChatSession'
import { useAiChatStatus } from './hooks/useAiChatStatus'
import { AiChatApiKeyState } from './layout/AiChatApiKeyState'
import { AiChatContextList } from './layout/AiChatContextList'
import { AiChatHistoryItem } from './layout/AiChatHistoryItem'
import { AiChatLoadingState } from './layout/AiChatLoadingState'
import { AiChatMessageView } from './layout/AiChatMessageView'
import { AiChatWelcomeState } from './layout/AiChatWelcomeState'
import { formatTokens, readAiStateKind } from './utils'
import type { JSX } from 'react'
import { onState } from '../../bridge'

export function AiChat(): JSX.Element {
    const { error, notice, setError, setNotice } = useAiChatStatus()
    const { runHostCommand } = useAiChatCommands({ onError: setError })
    const { contexts, setContexts, loadContexts, removeContext, clearContexts } = useAiChatContexts({
        onError: setError,
        onNotice: setNotice,
    })
    const { sessions, loadSessions } = useAiChatHistory({ onError: setError })
    const { runtime, loadRuntime } = useAiChatRuntime({ onError: setError })
    const { session, phase, input, setInput, loadSession, send, stop, startNewSession, switchSession, deleteSession } =
        useAiChatSession({
            onError: setError,
            onNotice: setNotice,
            setContexts,
            refreshSessions: loadSessions,
        })

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
                        onOpenChange={(isOpen: boolean) => {
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
                                        <AiChatHistoryItem
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
                                        <AiChatLoadingState />
                                    ) : hasApiKey ? (
                                        <AiChatWelcomeState />
                                    ) : (
                                        <AiChatApiKeyState onSetup={() => void runHostCommand('zhai.ai.setApiKey')} />
                                    )
                                ) : null}
                                {messages.map((message) => (
                                    <MessageScrollerItem
                                        key={message.id}
                                        messageId={message.id}
                                        scrollAnchor={message.id === lastMessageId}
                                    >
                                        <AiChatMessageView message={message} />
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
                    <AiChatContextList
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
