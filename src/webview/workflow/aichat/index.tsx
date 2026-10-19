/**
 * AI 对话页：MessageScroller 托管消息流（自动滚动 + 回到底部按钮），Message + Bubble 呈现消息，
 * 空态用 Empty、输入区用三段式输入卡片（工具行 / 输入框 / 操作行）；流式正文经宿主 stream 增量渲染。
 * 底部卡片承载写作命令、参考资料占位、对话 / 写作模式切换、Token 圆环、增强提示词与发送，
 * 写作模式的结果由消息底部「应用到编辑栏」写回编辑器（宿主校验文档版本）。
 * 会话 / 上下文 / 运行时 / 历史 / 写回 / 宿主命令操作拆分至 hooks/，页面区块与消息渲染拆分至 layout/。
 * 设计源：docs/modules/ai-chat.md 第 4.2 节对话状态机与第 10.3 节写回链路。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AiConversationMode } from '@/shared/types/aiChat'
import { useAiChatCommands } from './hooks/useAiChatCommands'
import { useAiChatContexts } from './hooks/useAiChatContexts'
import { useAiChatHistory } from './hooks/useAiChatHistory'
import { useAiChatRuntime } from './hooks/useAiChatRuntime'
import { useAiChatSession } from './hooks/useAiChatSession'
import { useAiChatStatus } from './hooks/useAiChatStatus'
import { useAiChatWriteState } from './hooks/useAiChatWriteState'
import { AiChatComposer } from './layout/AiChatComposer'
import { AiChatHeader } from './layout/AiChatHeader'
import { AiChatMessageList } from './layout/AiChatMessageList'
import { readAiStateKind } from './utils'
import type { AiCommand, AiCommandId, AiReferenceSource } from './constants'
import type { Phase } from './hooks/useAiChatSession'
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
    const { writeState, applyingMessageId, loadWriteState, applyMessage } = useAiChatWriteState({
        onError: setError,
        onNotice: setNotice,
    })
    const {
        session,
        phase,
        input,
        setInput,
        loadSession,
        send,
        stop,
        startNewSession,
        switchSession,
        switchMode,
        deleteSession,
    } = useAiChatSession({
        onError: setError,
        onNotice: setNotice,
        setContexts,
        refreshSessions: loadSessions,
    })
    /** 当前写作命令：决定本轮结果是否提供写回入口（找错别字只报告不写回） */
    const [commandId, setCommandId] = useState<AiCommandId | null>(null)
    /** 阶段回退到 idle 时刷新用量与写回状态，避免首次挂载重复请求 */
    const previousPhaseRef = useRef<Phase>('idle')

    // 会话就绪后再读取写回状态，保证可写回集合与当前活跃会话一致
    useEffect(() => {
        void loadSession().then(() => loadWriteState())
        void loadRuntime()
    }, [loadRuntime, loadSession, loadWriteState])

    // 密钥增删、上下文与写回状态由宿主广播，按 kind 刷新对应数据
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
            if (kind === 'writeTarget') {
                void loadWriteState()
            }
        })
    }, [loadContexts, loadRuntime, loadWriteState])

    // 生成结束后刷新当日用量与可写回集合（宿主也会广播，前端兜底保证圆环及时更新）
    useEffect(() => {
        if (previousPhaseRef.current !== 'idle' && phase === 'idle') {
            void loadRuntime()
            void loadWriteState()
        }
        previousPhaseRef.current = phase
    }, [loadRuntime, loadWriteState, phase])

    const messages = session?.messages ?? []
    /** 末条消息作为滚动锚点，流式增长时由 MessageScroller 保持贴底 */
    const lastMessageId = messages[messages.length - 1]?.id
    const hasApiKey = runtime?.hasApiKey === true
    const isGenerating = phase === 'streaming'
    const mode: AiConversationMode = session?.conversation.mode ?? 'chat'
    const hasWriteTarget = writeState?.target !== null && writeState?.target !== undefined
    const hint =
        mode === 'write' && writeState !== null && !hasWriteTarget
            ? '请先在编辑器中选中要改写的文本（整篇超过 12000 字时请分段选中）'
            : null

    /** 命令点击：输入为空直接填入模板，否则追加一行，避免覆盖用户已写内容 */
    const handleCommand = useCallback(
        (command: AiCommand): void => {
            setCommandId(command.id)
            setInput(input.trim().length === 0 ? command.instruction : `${input.trimEnd()}\n${command.instruction}`)
        },
        [input, setInput],
    )

    /** 参考资料当前全是占位：只给提示，不发起任何宿主请求 */
    const handleReference = useCallback(
        (source: AiReferenceSource): void => {
            setNotice(`参考资料即将上线：${source.title}`)
        },
        [setNotice],
    )

    const handleModeChange = useCallback(
        (next: AiConversationMode): void => {
            void switchMode(next).then(() => loadWriteState())
        },
        [loadWriteState, switchMode],
    )

    const handleSend = useCallback((): void => {
        void send(commandId === 'typo' ? 'report' : 'replace').then(() => setCommandId(null))
    }, [commandId, send])

    const handleNewSession = useCallback((): void => {
        void startNewSession().then(() => loadWriteState())
    }, [loadWriteState, startNewSession])

    const handleSwitchSession = useCallback(
        (id: string): void => {
            void switchSession(id).then(() => loadWriteState())
        },
        [loadWriteState, switchSession],
    )

    const handleApply = useCallback(
        (messageId: string): void => {
            void applyMessage(messageId)
        },
        [applyMessage],
    )

    return (
        <div className="flex h-screen flex-col">
            <AiChatHeader
                title={session?.conversation.title ?? 'AI 对话'}
                runtime={runtime}
                sessions={sessions}
                activeSessionId={session?.conversation.id}
                onOpenHistory={() => void loadSessions()}
                onSwitchSession={handleSwitchSession}
                onDeleteSession={(id) => void deleteSession(id).then(() => loadWriteState())}
                onNewSession={handleNewSession}
            />
            <div className="min-h-0 flex-1">
                <AiChatMessageList
                    messages={messages}
                    lastMessageId={lastMessageId}
                    phase={phase}
                    runtime={runtime}
                    hasApiKey={hasApiKey}
                    applyState={
                        writeState
                            ? {
                                  appliableMessageIds: writeState.appliableMessageIds,
                                  appliedMessageIds: writeState.appliedMessageIds,
                                  applyingMessageId,
                                  scopes: writeState.appliableScopes,
                                  onApply: handleApply,
                              }
                            : null
                    }
                    onSetupApiKey={() => void runHostCommand('zhai.ai.setApiKey')}
                />
            </div>
            <AiChatComposer
                contexts={contexts}
                input={input}
                setInput={setInput}
                hasApiKey={hasApiKey}
                isRuntimeReady={runtime !== null}
                isGenerating={isGenerating}
                phase={phase}
                mode={mode}
                usedTokens={runtime?.usedTokensToday ?? 0}
                dailyTokenBudget={runtime?.dailyTokenBudget ?? 0}
                hasWriteTarget={hasWriteTarget}
                error={error}
                notice={notice}
                hint={hint}
                onSend={handleSend}
                onStop={() => void stop()}
                onRemoveContext={(id) => void removeContext(id)}
                onClearContexts={() => void clearContexts()}
                onCommand={handleCommand}
                onReference={handleReference}
                onModeChange={handleModeChange}
            />
        </div>
    )
}
