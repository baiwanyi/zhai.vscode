/**
 * AI 对话页：以 app-page 骨架承载「标题与用量区 + 消息流 + 底部输入区」。
 * 复用约定：外壳取 @webview/components/AppPage（会话标题走 AppTitle，作品标题与用量走 AppSummary、
 * 历史与新建会话并进标题行 AppAction，消息流走 AppContent，输入区落 AppFooter）；
 * 消息流由 MessageScroller 托管，Message + Bubble 呈现消息，空态用 Empty，输入区为三段式输入卡片。
 * 本层只做装配与渲染：会话 / 上下文 / 运行时分 / 历史 / 模型 / 写入状态拆在 hooks/，
 * 草稿与命令选择在 useAiChatDraft，宿主广播与首屏同步在 useAiChatPageSync，
 * 连续生成授权在 useAiChatAutoApprove，页面区块与消息渲染拆在 layout/，纯函数与视图阶段类型在 utils。
 * 会话固定为写作模式：模型直接读写作品目录与当前文档，查询资料走只读工具；
 * 写入边界由宿主的工具守卫逐次裁决，前端只负责展示与发送。
 * 设计源：docs/modules/ai-chat.md 第 4 节会话状态机与第 10.3 节底部输入卡片。
 * 关键约束：入口组件由 workflow 分区路由直接引用，文件名即组件名 WorkflowAiChat，目录不再提供 index 出口；
 * 会话按 projectDir 作用域隔离，作品页传入当前作品目录即换用该作品的对话记录，缺省为通用对话；
 * 页面高度由 AppPage 的 h-full 承接骨架链条，不再自建 h-screen，避免嵌在分区容器里时撑出视口。
 */
import { SquarePen } from 'lucide-react'
import { useCallback, useState } from 'react'
import type { AiMentionCandidate, AiReferenceEntry } from '@shared/types/aiChat'
import { AppAction, AppContent, AppFooter, AppHeader, AppPage, AppTitle } from '@webview/components/AppPage'
import { AppSummary } from '@webview/components/AppSummary'
import { Button } from '@webview/components/Button'
import { useAiChatAutoApprove } from './hooks/useAiChatAutoApprove'
import { useAiChatCommands } from './hooks/useAiChatCommands'
import { useAiChatContexts } from './hooks/useAiChatContexts'
import { useAiChatDraft } from './hooks/useAiChatDraft'
import { useAiChatEnhance } from './hooks/useAiChatEnhance'
import { useAiChatHistory } from './hooks/useAiChatHistory'
import { useAiChatMention } from './hooks/useAiChatMention'
import { useAiChatModels } from './hooks/useAiChatModels'
import { useAiChatPageSync } from './hooks/useAiChatPageSync'
import { useAiChatPermission } from './hooks/useAiChatPermission'
import { useAiChatReference } from './hooks/useAiChatReference'
import { useAiChatRuntime } from './hooks/useAiChatRuntime'
import { useAiChatSession } from './hooks/useAiChatSession'
import { useAiChatStatus } from './hooks/useAiChatStatus'
import { useAiChatWriteState } from './hooks/useAiChatWriteState'
import { AiChatAutoApproveDialog } from './layout/AiChatAutoApproveDialog'
import { AiChatComposer } from './layout/AiChatComposer'
import { AiChatHistoryMenu } from './layout/AiChatHistoryMenu'
import { AiChatMentionDialog } from './layout/AiChatMentionDialog'
import { AiChatMessageList } from './layout/AiChatMessageList'
import { AiChatReferenceDialog } from './layout/AiChatReferenceDialog'
import { composeCommandContent, resolveWritableScope, toUsageText } from './utils'
import type { AiReferenceAction } from './layout/AiChatReferenceMenu'
import type { JSX } from 'react'

/** 对话页对外入参：会话作用域与作品标题，其余状态全部由页面内部 hooks 持有 */
export interface WorkflowAiChatProps {
    /** 会话作用域（作品目录）：同一作品共用一份对话记录，缺省或 null 表示不属于任何作品的通用对话 */
    projectDir?: string | null
    /** 当前作品标题：由调用方从作品设定中取，缺省时摘要行回落为通道名 */
    projectTitle?: string | null
}

export function WorkflowAiChat({ projectDir = null, projectTitle = null }: WorkflowAiChatProps): JSX.Element {
    const { setError } = useAiChatStatus()
    const { runLoginCodebuddy } = useAiChatCommands({ onError: setError })
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
        transientNotice,
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
    // 草稿按会话保存：未发送正文与命令防抖写入宿主，快照回填的命令由本 hook 判定是否套用
    const { command, selectCommand, clearCommand, applySnapshot, restoreFromMessage } = useAiChatDraft({
        conversationId: session?.conversation.id ?? null,
        input,
        setInput,
    })
    // 宿主广播与首屏加载统一编排：密钥、上下文、写回目标变更与生成结束都走这里刷新
    useAiChatPageSync({
        phase,
        loadSession,
        loadRuntime,
        loadContexts,
        loadWriteState,
        onSnapshot: applySnapshot,
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
        addPath: addMentionPath,
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
    // 连续生成授权：发送成功后的命令清空在此统一收尾
    const {
        pending: pendingAutoApprove,
        submit: submitMessage,
        confirm: confirmAutoApprove,
        dismiss: dismissAutoApprove,
    } = useAiChatAutoApprove({ send, onSent: clearCommand })

    const messages = session?.messages ?? []
    /** 末条消息作为滚动锚点，流式增长时由 MessageScroller 保持贴底 */
    const lastMessageId = messages[messages.length - 1]?.id
    const hasApiKey = runtime?.hasApiKey === true
    const writeGrant = session?.conversation.writeGrant ?? 'document'
    /** 可写范围：编辑器目标或作品目录任一存在即可发送，连续生成章节不依赖选区 */
    const hasWritableScope = resolveWritableScope(projectDir, writeState)
    /** 当前模型：菜单展开过时以菜单数据为准，否则用运行时带回的模型 id 兜底 */
    const currentModel = modelChoices?.current ?? runtime?.model ?? ''
    /** 当前模型展示名：初始化阶段菜单清单尚未拉取，先用运行时带回的名称，避免闪出模型 id */
    const currentModelName = runtime?.modelName ?? ''
    /** 会话标题：随会话切换，未建会话时回落为通用文案 */
    const title = session?.conversation.title ?? 'AI 对话'
    /** 作品标题：无作品或标题未就绪时回落为通道名，保证用量徽标仍有承载行 */
    const projectLabel = projectTitle !== null && projectTitle.length > 0 ? projectTitle : 'CodeBuddy'
    /** 用量行：订阅制通道不展示预算分母；运行时未就绪时给出读取提示 */
    const usageText = toUsageText(runtime)

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

    /** 发送：指令模板与用户补充在此拼装，输入区与消息气泡始终只呈现命令名 */
    const handleSend = useCallback((): void => {
        const content = command === null ? input : composeCommandContent(command, input)
        void submitMessage(content, { writeGrant, titleHint: command?.title })
    }, [command, input, submitMessage, writeGrant])

    const handleNewSession = useCallback((): void => {
        clearCommand()
        void startNewSession().then(() => loadWriteState())
    }, [clearCommand, loadWriteState, startNewSession])

    const handleSwitchSession = useCallback(
        (id: string): void => {
            clearCommand()
            void switchSession(id).then((snapshot) => {
                if (snapshot !== null) {
                    applySnapshot(snapshot)
                }
                void loadWriteState()
            })
        },
        [applySnapshot, clearCommand, loadWriteState, switchSession],
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
                    transientNotice={transientNotice}
                    pendingApproval={pendingPermission}
                    onAnswer={(decision) => void respondPermission(decision)}
                    onRepeat={restoreFromMessage}
                    runtime={runtime}
                    onLoginCodebuddy={() => void runLoginCodebuddy()}
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
                    onWriteGrantChange={(grant) => void switchWriteGrant(grant)}
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
                    onCommand={selectCommand}
                    onOpenModels={() => void loadModels()}
                    onSelectModel={(modelId) => void selectModel(modelId)}
                    onSelectContextWindow={(tokens) => void selectContextWindow(tokens)}
                    onSelectEffort={(effort) => void selectEffort(effort)}
                    onClearCommand={clearCommand}
                    onReference={handleReference}
                    onMention={handleMention}
                    isEnhancing={isEnhancing}
                    onEnhanceRequest={enhance}
                    onAddZhaiRef={addMentionPath}
                />
            </AppFooter>
            <AiChatAutoApproveDialog
                pending={pendingAutoApprove}
                onConfirm={confirmAutoApprove}
                onDismiss={dismissAutoApprove}
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
