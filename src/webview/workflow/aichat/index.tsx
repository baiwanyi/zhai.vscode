/**
 * AI 对话页：MessageScroller 托管消息流（自动滚动 + 回到底部按钮），Message + Bubble 呈现消息，
 * 空态用 Empty、输入区用三段式输入卡片（工具行 / 输入框 / 操作行）；流式正文经宿主 stream 增量渲染。
 * 底部卡片承载写作命令（徽章展示，指令模板在发送时拼装）、参考资料占位、对话 / 写作模式切换、
 * 模型菜单（展开时按需拉取账号可用清单）、Token 圆环、增强提示词与发送；
 * 写作模式的结果由消息底部「应用到编辑栏」写回编辑器（宿主校验文档版本）。
 * 会话 / 上下文 / 运行时 / 历史 / 模型 / 写回 / 宿主命令操作拆分至 hooks/，页面区块与消息渲染拆分至 layout/。
 * 设计源：docs/modules/ai-chat.md 第 4.2 节对话状态机与第 10.3 节写回链路。
 * 关键约束：会话按 projectDir 作用域隔离，作品页传入当前作品目录即换用该作品的对话记录，缺省为通用对话。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { AiConversationMode, AiSessionSnapshot } from '@shared/types/aiChat'
import { AI_COMMAND_MAP, isAiCommandId } from './constants'
import { useAiChatCommands } from './hooks/useAiChatCommands'
import { useAiChatContexts } from './hooks/useAiChatContexts'
import { useAiChatHistory } from './hooks/useAiChatHistory'
import { useAiChatModels } from './hooks/useAiChatModels'
import { useAiChatRuntime } from './hooks/useAiChatRuntime'
import { useAiChatSession } from './hooks/useAiChatSession'
import { useAiChatStatus } from './hooks/useAiChatStatus'
import { useAiChatWriteState } from './hooks/useAiChatWriteState'
import { AiChatComposer } from './layout/AiChatComposer'
import { AiChatHeader } from './layout/AiChatHeader'
import { AiChatMessageList } from './layout/AiChatMessageList'
import { composeCommandContent, readAiStateKind } from './utils'
import type { AiCommand, AiCommandId, AiReferenceSource } from './constants'
import type { Phase } from './hooks/useAiChatSession'
import type { JSX } from 'react'
import { onState, request } from '../../bridge'

/** 对话页对外入参：只有会话作用域一项，其余状态全部由页面内部 hooks 持有 */
export interface AiChatProps {
    /** 会话作用域（作品目录）：同一作品共用一份对话记录，缺省或 null 表示不属于任何作品的通用对话 */
    projectDir?: string | null
}

export function AiChat({ projectDir = null }: AiChatProps): JSX.Element {
    const { setError, setNotice } = useAiChatStatus()
    const { runHostCommand } = useAiChatCommands({ onError: setError })
    const { contexts, setContexts, loadContexts, removeContext } = useAiChatContexts({
        onError: setError,
        onNotice: setNotice,
    })
    const { sessions, loadSessions } = useAiChatHistory({ onError: setError, projectDir })
    const {
        choices: modelChoices,
        isLoading: isLoadingModels,
        loadModels,
        selectModel,
    } = useAiChatModels({ onError: setError })
    const { runtime, loadRuntime } = useAiChatRuntime({ onError: setError })
    const { writeState, applyingMessageId, loadWriteState, applyMessage } = useAiChatWriteState({ onError: setError })
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
        projectDir,
    })
    /** 当前写作命令：决定本轮结果是否提供写回入口（校对只报告不写回） */
    const [commandId, setCommandId] = useState<AiCommandId | null>(null)
    /** 阶段回退到 idle 时刷新用量与写回状态，避免首次挂载重复请求 */
    const previousPhaseRef = useRef<Phase>('idle')
    /** 已套用草稿的会话 id：避免重复套用把用户之后主动取消的命令重新恢复 */
    const restoredDraftRef = useRef<string | null>(null)
    /** 命令选择的最新值：草稿套用时判断本地是否已有选择 */
    const commandIdRef = useRef<AiCommandId | null>(null)

    useEffect(() => {
        commandIdRef.current = commandId
    }, [commandId])

    /** 套用草稿中的命令：同一会话只处理一次，本地已选命令时保留本地选择 */
    const applyDraftCommand = useCallback((snapshot: AiSessionSnapshot): void => {
        const conversationId = snapshot.conversation.id
        if (restoredDraftRef.current === conversationId) {
            return
        }
        restoredDraftRef.current = conversationId
        if (commandIdRef.current !== null || !isAiCommandId(snapshot.draft.commandId)) {
            return
        }
        commandIdRef.current = snapshot.draft.commandId
        setCommandId(snapshot.draft.commandId)
    }, [])

    // 会话就绪后恢复草稿中的命令并读取写回状态，保证可写回集合与当前活跃会话一致
    useEffect(() => {
        void loadSession().then((snapshot) => {
            if (snapshot !== null) {
                applyDraftCommand(snapshot)
            }
            void loadWriteState()
        })
        void loadRuntime()
    }, [applyDraftCommand, loadRuntime, loadSession, loadWriteState])

    /** 当前会话 id：草稿按会话保存，避免写到别的会话 */
    const activeConversationId = session?.conversation.id ?? null

    // 未发送正文与命令防抖写入宿主草稿：侧边栏切换导致 webview 重建后由会话快照带回
    useEffect(() => {
        if (activeConversationId === null) {
            return
        }
        const timer = setTimeout(() => {
            void request('ai/draft', { conversationId: activeConversationId, input, commandId })
        }, 300)
        return (): void => {
            clearTimeout(timer)
        }
    }, [activeConversationId, commandId, input])

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
    /** 已选写作命令：输入区只展示命令名徽章，指令模板在发送时拼装 */
    const command = commandId === null ? null : AI_COMMAND_MAP[commandId]
    /** 当前模型：菜单展开过时以菜单数据为准，否则用运行时带回的模型 id 兜底 */
    const currentModel = modelChoices?.current ?? runtime?.model ?? ''
    /** 当前模型展示名：初始化阶段菜单清单尚未拉取，先用运行时带回的名称，避免闪出模型 id */
    const currentModelName = runtime?.modelName ?? ''

    /** 命令点击：只记录选择（再次点击取消），指令模板不写入输入框 */
    const handleCommand = useCallback((next: AiCommand): void => {
        setCommandId((previous) => (previous === next.id ? null : next.id))
    }, [])

    /** 模型选择：写入结果由宿主广播运行时变更，本层只透传点击 */
    const handleSelectModel = useCallback(
        (modelId: string, manual: boolean): void => {
            void selectModel(modelId, manual)
        },
        [selectModel],
    )

    const handleClearCommand = useCallback((): void => {
        commandIdRef.current = null
        setCommandId(null)
    }, [])

    /** 参考资料当前全是占位：只给提示，不发起任何宿主请求 */
    const handleReference = useCallback((source: AiReferenceSource): void => {
        toast.info(`参考资料即将上线：${source.title}`)
    }, [])

    const handleModeChange = useCallback(
        (next: AiConversationMode): void => {
            void switchMode(next).then(() => loadWriteState())
        },
        [loadWriteState, switchMode],
    )

    /** 发送：指令模板与用户补充在此拼装，输入区与消息气泡始终只呈现命令名 */
    const handleSend = useCallback((): void => {
        const content = command === null ? input : composeCommandContent(command, input)
        void send(content, {
            applyPolicy: command?.applyPolicy ?? 'replace',
            titleHint: command?.title,
        }).then((sent) => {
            if (sent) {
                commandIdRef.current = null
                setCommandId(null)
            }
        })
    }, [command, input, send])

    const handleNewSession = useCallback((): void => {
        commandIdRef.current = null
        setCommandId(null)
        void startNewSession().then(() => loadWriteState())
    }, [loadWriteState, startNewSession])

    const handleSwitchSession = useCallback(
        (id: string): void => {
            commandIdRef.current = null
            setCommandId(null)
            void switchSession(id).then((snapshot) => {
                if (snapshot !== null) {
                    applyDraftCommand(snapshot)
                }
                void loadWriteState()
            })
        },
        [applyDraftCommand, loadWriteState, switchSession],
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
                    onLoginCodebuddy={() => void runHostCommand('zhai.ai.loginCodebuddy')}
                />
            </div>
            <AiChatComposer
                contexts={contexts}
                input={input}
                setInput={setInput}
                hasApiKey={hasApiKey}
                isGenerating={isGenerating}
                phase={phase}
                mode={mode}
                usedTokens={runtime?.usedTokensToday ?? 0}
                dailyTokenBudget={runtime?.dailyTokenBudget ?? 0}
                hasWriteTarget={hasWriteTarget}
                hint={hint}
                command={command}
                model={currentModel}
                modelName={currentModelName}
                modelChoices={modelChoices}
                isLoadingModels={isLoadingModels}
                onSend={handleSend}
                onStop={() => void stop()}
                onRemoveContext={(id) => void removeContext(id)}
                onCommand={handleCommand}
                onOpenModels={() => void loadModels()}
                onSelectModel={handleSelectModel}
                onClearCommand={handleClearCommand}
                onReference={handleReference}
                onModeChange={handleModeChange}
            />
        </div>
    )
}
