/**
 * AI 对话页：以 app-page 骨架承载「标题与用量区 + 消息流 + 底部输入区」。
 * 复用约定：外壳取 @webview/components/AppPage（会话标题走 AppTitle，作品标题与用量走 AppSummary、
 * 历史与新建会话并进标题行 AppAction，消息流走 AppContent，输入区落 AppFooter），
 * 消息流由 MessageScroller 托管（自动滚动 + 回到底部按钮），Message + Bubble 呈现消息，
 * 空态用 Empty、输入区用三段式输入卡片（工具行 / 输入框 / 操作行）；
 * 流式正文与思维链按 channel 分流增量渲染，思考过程以折叠轨迹呈现在正文上方。
 * 底部卡片承载写作命令（徽章展示，指令模板在发送时拼装）、参考资料与提及检索、写入范围、
 * 模型菜单（展开时按需拉取账号可用清单）、上下文圆环、增强提示词（走文本通道改写，经 ai/enhancePrompt）与发送；
 * 会话固定为写作模式：模型直接读写作品目录与当前文档，查询资料走只读工具；
 * 写入边界由宿主的工具守卫逐次裁决，连续生成在发送前弹一次「本轮直接写入」授权，前端只负责展示与发送。
 * 会话 / 上下文 / 运行时 / 历史 / 模型 / 写入状态 / 宿主命令操作拆分至 hooks/，页面区块与消息渲染拆分至 layout/。
 * 设计源：docs/modules/ai-chat.md 第 4 节会话状态机与第 10.3 节底部输入卡片。
 * 关键约束：会话按 projectDir 作用域隔离，作品页传入当前作品目录即换用该作品的对话记录，缺省为通用对话；
 * 页面高度由 AppPage 的 h-full 承接骨架链条，不再自建 h-screen，避免嵌在分区容器里时撑出视口；
 * 生成中的呼吸光晕挂在输入卡片外侧（见 AiChatComposer），与生图页共用 globals.css 的 composer-glow 段。
 */
import { SquarePen } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
    AiMentionCandidate,
    AiReasoningEffort,
    AiReferenceEntry,
    AiSessionSnapshot,
    AiWriteGrant,
} from '@shared/types/aiChat'
import { onState, request } from '@shared/utils/bridge'
import { formatTokens } from '@shared/utils/format'
import { AppAction, AppContent, AppFooter, AppHeader, AppPage, AppTitle } from '@webview/components/AppPage'
import { AppSummary } from '@webview/components/AppSummary'
import { Button } from '@webview/components/Button'
import { ConfirmDialog } from '@webview/components/ConfirmDialog'
import { AI_COMMAND_MAP, isAiCommandId } from './constants'
import { useAiChatCommands } from './hooks/useAiChatCommands'
import { useAiChatContexts } from './hooks/useAiChatContexts'
import { useAiChatEnhance } from './hooks/useAiChatEnhance'
import { useAiChatHistory } from './hooks/useAiChatHistory'
import { useAiChatMention } from './hooks/useAiChatMention'
import { useAiChatModels } from './hooks/useAiChatModels'
import { useAiChatPermission } from './hooks/useAiChatPermission'
import { useAiChatReference } from './hooks/useAiChatReference'
import { useAiChatRuntime } from './hooks/useAiChatRuntime'
import { useAiChatSession } from './hooks/useAiChatSession'
import { useAiChatStatus } from './hooks/useAiChatStatus'
import { useAiChatWriteState } from './hooks/useAiChatWriteState'
import { AiChatComposer } from './layout/AiChatComposer'
import { AiChatHistoryMenu } from './layout/AiChatHistoryMenu'
import { AiChatMentionDialog } from './layout/AiChatMentionDialog'
import { AiChatMessageList } from './layout/AiChatMessageList'
import { AiChatPermissionDialog } from './layout/AiChatPermissionDialog'
import { AiChatReferenceDialog } from './layout/AiChatReferenceDialog'
import { composeCommandContent, readAiStateKind, wantsContinuousGeneration } from './utils'
import type { AiCommand, AiCommandId } from './constants'
import type { Phase } from './hooks/useAiChatSession'
import type { AiReferenceAction } from './layout/AiChatReferenceMenu'
import type { JSX } from 'react'

/** 对话页对外入参：会话作用域与作品标题，其余状态全部由页面内部 hooks 持有 */
export interface AiChatProps {
    /** 会话作用域（作品目录）：同一作品共用一份对话记录，缺省或 null 表示不属于任何作品的通用对话 */
    projectDir?: string | null
    /** 当前作品标题：由调用方从作品设定中取，缺省时摘要行回落为通道名 */
    projectTitle?: string | null
}

export function AiChat({ projectDir = null, projectTitle = null }: AiChatProps): JSX.Element {
    const { setError } = useAiChatStatus()
    const { runHostCommand } = useAiChatCommands({ onError: setError })
    const { isEnhancing, enhance } = useAiChatEnhance()
    const { contexts, setContexts, loadContexts, removeContext } = useAiChatContexts({ onError: setError })
    const { sessions, loadSessions } = useAiChatHistory({ onError: setError, projectDir })
    const {
        choices: modelChoices,
        isLoading: isLoadingModels,
        loadModels,
        selectModel,
        selectContextWindow,
        selectEffort,
    } = useAiChatModels({ onError: setError })
    const { runtime, loadRuntime } = useAiChatRuntime({ onError: setError })
    const { writeState, loadWriteState } = useAiChatWriteState({ onError: setError })
    const {
        session,
        phase,
        input,
        setInput,
        contextUsage,
        activeTool,
        loadSession,
        send,
        stop,
        startNewSession,
        switchSession,
        switchWriteGrant,
        deleteSession,
    } = useAiChatSession({
        onError: setError,
        setContexts,
        refreshSessions: loadSessions,
        projectDir,
    })
    // 审批队列独立订阅 stream：与消息增量互不影响，宿主推送待确认事项时弹出对应界面
    const { pending: pendingPermission, respond: respondPermission } = useAiChatPermission({ onError: setError })
    // 提及检索依赖会话快照的刷新函数，必须排在 useAiChatSession 之后
    const [isMentionOpen, setIsMentionOpen] = useState(false)
    const {
        candidates: mentionCandidates,
        isSearching: isMentionSearching,
        search: searchMention,
        add: addMention,
        reset: resetMention,
    } = useAiChatMention({
        onError: setError,
        // 添加成功后重拉会话快照：上下文芯片由宿主维护，前端不本地拼装
        onAdded: (): void => {
            void loadSession()
        },
    })
    const [isReferenceOpen, setIsReferenceOpen] = useState(false)
    const {
        entries: referenceEntries,
        isSearching: isReferenceSearching,
        search: searchReference,
        add: addReference,
        openDir: openReferenceDir,
        reset: resetReference,
    } = useAiChatReference({
        onError: setError,
        onAdded: (): void => {
            void loadSession()
        },
    })
    /** 当前已选写作命令：输入区以芯片展示 */
    const [commandId, setCommandId] = useState<AiCommandId | null>(null)
    /** 待确认的连续生成请求：非空时弹一次「本轮直接写入」授权框 */
    const [pendingAutoApprove, setPendingAutoApprove] = useState<{
        content: string
        titleHint: string | undefined
    } | null>(null)
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

    // 会话就绪后恢复草稿中的命令并读取写入状态，保证写入目标与当前活跃会话一致
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

    // 生成结束后刷新当日用量与写入状态（宿主也会广播，前端兜底保证圆环及时更新）
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
    const writeGrant = session?.conversation.writeGrant ?? 'project'
    const hasWriteTarget = writeState?.target !== null && writeState?.target !== undefined
    /** 可写范围：编辑器目标或作品目录任一存在即可发送，连续生成章节不依赖选区 */
    const hasWritableScope = hasWriteTarget || (projectDir !== null && projectDir.length > 0)
    /** 已选写作命令：输入区只展示命令名徽章，指令模板在发送时拼装 */
    const command = commandId === null ? null : AI_COMMAND_MAP[commandId]
    /** 当前模型：菜单展开过时以菜单数据为准，否则用运行时带回的模型 id 兜底 */
    const currentModel = modelChoices?.current ?? runtime?.model ?? ''
    /** 当前模型展示名：初始化阶段菜单清单尚未拉取，先用运行时带回的名称，避免闪出模型 id */
    const currentModelName = runtime?.modelName ?? ''
    /** 会话标题：随会话切换，未建会话时回落为通用文案 */
    const title = session?.conversation.title ?? 'AI 对话'
    /** 作品标题：无作品或标题未就绪时回落为通道名，保证用量徽标仍有承载行 */
    const projectLabel = projectTitle !== null && projectTitle.length > 0 ? projectTitle : 'CodeBuddy'
    /** 用量行：订阅制通道不展示预算分母；运行时未就绪时给出读取提示，避免闪出 0 */
    const usageText = runtime === null ? '正在读取配置…' : `今日 ${formatTokens(runtime.usedTokensToday)} tokens`

    /** 命令点击：只记录选择（再次点击取消），指令模板不写入输入框 */
    const handleCommand = useCallback((next: AiCommand): void => {
        setCommandId((previous) => (previous === next.id ? null : next.id))
    }, [])

    /** 模型选择：写入结果由宿主广播运行时变更，本层只透传点击 */
    const handleSelectModel = useCallback(
        (modelId: string): void => {
            void selectModel(modelId)
        },
        [selectModel],
    )

    /** 档位选择：是否落在模型可选范围内由宿主裁决，本层只透传点击 */
    const handleSelectContextWindow = useCallback(
        (tokens: number): void => {
            void selectContextWindow(tokens)
        },
        [selectContextWindow],
    )

    /** 推理强度：白名单由宿主校验，本层只透传选择结果 */
    const handleSelectEffort = useCallback(
        (effort: AiReasoningEffort | null): void => {
            void selectEffort(effort)
        },
        [selectEffort],
    )

    const handleClearCommand = useCallback((): void => {
        commandIdRef.current = null
        setCommandId(null)
    }, [])

    /** 参考菜单：检索语料，或打开语料目录（目录不存在时由宿主创建） */
    const handleReference = useCallback(
        (action: AiReferenceAction): void => {
            if (action === 'search') {
                setIsReferenceOpen(true)
                return
            }
            void openReferenceDir()
        },
        [openReferenceDir],
    )

    const handleReferencePick = useCallback(
        (entry: AiReferenceEntry): void => {
            void addReference(entry).then((isAdded) => {
                if (isAdded) {
                    setIsReferenceOpen(false)
                    resetReference()
                }
            })
        },
        [addReference, resetReference],
    )

    const handleReferenceClose = useCallback((): void => {
        setIsReferenceOpen(false)
        resetReference()
    }, [resetReference])

    /** 打开提及检索：候选来自全文索引，选中即加为上下文 */
    const handleMention = useCallback((): void => {
        setIsMentionOpen(true)
    }, [])

    const handleMentionPick = useCallback(
        (candidate: AiMentionCandidate): void => {
            void addMention(candidate).then((isAdded) => {
                if (isAdded) {
                    setIsMentionOpen(false)
                    resetMention()
                }
            })
        },
        [addMention, resetMention],
    )

    const handleMentionClose = useCallback((): void => {
        setIsMentionOpen(false)
        resetMention()
    }, [resetMention])

    /** 写入范围只影响后续发送下发的白名单，切换后无需重新拉取写回状态 */
    const handleWriteGrantChange = useCallback(
        (next: AiWriteGrant): void => {
            void switchWriteGrant(next)
        },
        [switchWriteGrant],
    )

    /** 发送：指令模板与用户补充在此拼装，输入区与消息气泡始终只呈现命令名 */
    const handleSend = useCallback((): void => {
        const content = command === null ? input : composeCommandContent(command, input)
        // 连续生成先取得一次授权：否则每写一个文件都要弹一次确认
        if (writeGrant === 'project' && wantsContinuousGeneration(content)) {
            setPendingAutoApprove({ content, titleHint: command?.title })
            return
        }
        void send(content, {
            titleHint: command?.title,
        }).then((sent) => {
            if (sent) {
                commandIdRef.current = null
                setCommandId(null)
            }
        })
    }, [command, input, send, writeGrant])

    /** 连续生成授权：确认后本轮直接写入，授权只对这一次发送生效 */
    const handleAutoApproveConfirm = useCallback((): void => {
        const pending = pendingAutoApprove
        setPendingAutoApprove(null)
        if (pending === null) {
            return
        }
        void send(pending.content, { autoApprove: true, titleHint: pending.titleHint }).then((sent) => {
            if (sent) {
                commandIdRef.current = null
                setCommandId(null)
            }
        })
    }, [pendingAutoApprove, send])

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

    return (
        <AppPage>
            <AppHeader>
                <AppTitle>{title}</AppTitle>
                <AppAction>
                    <AiChatHistoryMenu
                        sessions={sessions}
                        activeSessionId={session?.conversation.id}
                        onOpen={() => void loadSessions()}
                        onSwitch={handleSwitchSession}
                        onDelete={(id) => void deleteSession(id).then(() => loadWriteState())}
                    />
                    <Button
                        variant="secondary"
                        size="icon"
                        className="rounded-full"
                        aria-label="新建会话"
                        tooltip="新建会话"
                        onClick={handleNewSession}
                    >
                        <SquarePen />
                    </Button>
                </AppAction>
                <AppSummary title={projectLabel} path={projectDir ?? undefined} meta={usageText} />
            </AppHeader>
            {/*
                h-0 是故意的：AppContent 只有 flex-1 时高度来自 flex 计算，MessageScroller 根节点的
                size-full（height:100%）没有确定的百分比基准，消息一多就会按内容高度撑开、把底栏顶出视口。
                显式 height:0 交给 flex 拉伸后，used height 才是 definitely sized，子项百分比高度才稳定。
            */}
            <AppContent className="flex h-0 flex-col mb-3">
                <AiChatMessageList
                    messages={messages}
                    lastMessageId={lastMessageId}
                    phase={phase}
                    runtime={runtime}
                    onLoginCodebuddy={() => void runHostCommand('zhai.ai.loginCodebuddy')}
                />
            </AppContent>
            <AppFooter>
                <AiChatComposer
                    contexts={contexts}
                    input={input}
                    setInput={setInput}
                    hasApiKey={hasApiKey}
                    phase={phase}
                    writeGrant={writeGrant}
                    onWriteGrantChange={handleWriteGrantChange}
                    activeTool={activeTool}
                    contextUsage={contextUsage}
                    contextWindowTokens={runtime?.contextWindowTokens ?? 0}
                    hasWritableScope={hasWritableScope}
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
                    onSelectContextWindow={handleSelectContextWindow}
                    onSelectEffort={handleSelectEffort}
                    onClearCommand={handleClearCommand}
                    onReference={handleReference}
                    onMention={handleMention}
                    isEnhancing={isEnhancing}
                    onEnhanceRequest={enhance}
                />
            </AppFooter>
            <AiChatPermissionDialog
                pending={pendingPermission}
                onRespond={(decision) => void respondPermission(decision)}
            />
            <ConfirmDialog
                open={pendingAutoApprove !== null}
                title="允许本轮直接写入？"
                description="本轮将允许模型在作品目录（含当前文档）内连续写入，不再逐个确认；授权仅对本次发送生效。"
                confirmLabel="允许并发送"
                onOpenChange={(isOpen) => {
                    if (!isOpen) {
                        setPendingAutoApprove(null)
                    }
                }}
                onConfirm={handleAutoApproveConfirm}
            />
            <AiChatMentionDialog
                open={isMentionOpen}
                candidates={mentionCandidates}
                isSearching={isMentionSearching}
                onSearch={(keyword) => void searchMention(keyword)}
                onPick={handleMentionPick}
                onClose={handleMentionClose}
            />
            <AiChatReferenceDialog
                open={isReferenceOpen}
                entries={referenceEntries}
                isSearching={isReferenceSearching}
                onSearch={(keyword) => void searchReference(keyword)}
                onPick={handleReferencePick}
                onClose={handleReferenceClose}
            />
        </AppPage>
    )
}
