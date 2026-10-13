/**
 * AI 对话页：MessageScroller 托管消息流（自动滚动 + 回到底部按钮），Message + Bubble 呈现消息，
 * 空态用 Empty、输入区用 InputGroup 组合，与 message-scroller 的官方界面模式一致；流式正文经宿主 stream 消息增量渲染。
 * 消息样式参考 Copilot / CodeBuddy：无头像与角色标签，用户消息为右对齐气泡，助手回复走 Bubble ghost 变体通栏纯文本。
 * 「添加到宅对话」的待发送上下文以 Attachment 清单呈现在输入区上方，已发送的引用作为消息内容的一部分随消息展示。
 * 顶部工具条提供「历史对话」浮层（对齐 Copilot：标题 + 相对时间，hover 显示删除），可切换与删除会话。
 * 会话 / 上下文 / 运行时 / 历史 / 宿主命令操作拆分至 hooks/，页面区块（顶栏 / 消息流 / 输入区）与消息渲染等拆分至 layout/。
 * 设计源：docs/modules/ai-chat.md 第 4.2 节对话状态机；交互约束：生成期间禁用发送并显示停止按钮。
 */
import { useEffect } from 'react'
import { Separator } from '@/components/ui/separator'
import { useAiChatCommands } from './hooks/useAiChatCommands'
import { useAiChatContexts } from './hooks/useAiChatContexts'
import { useAiChatHistory } from './hooks/useAiChatHistory'
import { useAiChatRuntime } from './hooks/useAiChatRuntime'
import { useAiChatSession } from './hooks/useAiChatSession'
import { useAiChatStatus } from './hooks/useAiChatStatus'
import { AiChatComposer } from './layout/AiChatComposer'
import { AiChatHeader } from './layout/AiChatHeader'
import { AiChatMessageList } from './layout/AiChatMessageList'
import { readAiStateKind } from './utils'
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

    return (
        <div className="flex h-screen flex-col">
            <AiChatHeader
                title={session?.conversation.title ?? 'AI 对话'}
                runtime={runtime}
                sessions={sessions}
                activeSessionId={session?.conversation.id}
                onOpenHistory={() => void loadSessions()}
                onSwitchSession={(id) => void switchSession(id)}
                onDeleteSession={(id) => void deleteSession(id)}
                onNewSession={() => void startNewSession()}
            />
            <Separator />
            <div className="min-h-0 flex-1">
                <AiChatMessageList
                    messages={messages}
                    lastMessageId={lastMessageId}
                    phase={phase}
                    runtime={runtime}
                    hasApiKey={hasApiKey}
                    onSetupApiKey={() => void runHostCommand('zhai.ai.setApiKey')}
                />
            </div>
            <AiChatComposer
                contexts={contexts}
                input={input}
                setInput={setInput}
                hasApiKey={hasApiKey}
                isGenerating={isGenerating}
                phase={phase}
                error={error}
                notice={notice}
                onSend={() => void send()}
                onStop={() => void stop()}
                onRemoveContext={(id) => void removeContext(id)}
                onClearContexts={() => void clearContexts()}
                onOpenSettings={() => void runHostCommand('zhai.openSettings')}
            />
        </div>
    )
}
