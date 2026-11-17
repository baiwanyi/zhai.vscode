/**
 * AI 对话页：以 app-page 骨架承载「标题与用量区 + 消息流 + 底部输入区」。
 * 复用约定：外壳取 @webview/components/AppPage（会话标题走 AppTitle，作品标题与用量走 AppSummary、
 * 历史与新建会话并进标题行 AppAction，消息流走 AppContent，输入区落 AppFooter）；
 * 消息流由 MessageScroller 托管，Message + Bubble 呈现消息，空态用 Empty，输入区为三段式输入卡片。
 * 本层只做装配与渲染：展示值汇总取 utils 的 resolveAiChatView，模型控制取 useAiChatModelControl，
 * 会话动作时序取 useAiChatConversationActions，检索弹窗的开关与选中收尾取 useAiChatPicker；
 * 会话 / 上下文 / 运行时 / 历史 / 写入状态拆在 hooks/，草稿与命令选择在 useAiChatDraft，
 * 宿主广播与首屏同步在 useAiChatPageSync，连续生成授权在 useAiChatAutoApprove，页面区块与消息渲染在 layout/。
 * 会话固定为写作模式：模型直接读写作品目录与当前文档，查询资料走只读工具；
 * 写入边界由宿主的工具守卫逐次裁决，前端只负责展示与发送。
 * 设计源：docs/modules/ai-chat.md 第 4 节会话状态机与第 10.3 节底部输入卡片。
 * 关键约束：入口组件由 workflow 分区路由直接引用，文件名即组件名 WorkflowAiChat，目录不再提供 index 出口；
 * 会话按 projectDir 作用域隔离，作品页传入当前作品目录即换用该作品的对话记录，缺省为通用对话；
 * 页面高度由 AppPage 的 h-full 承接骨架链条，不再自建 h-screen，避免嵌在分区容器里时撑出视口；
 * 异步动作交给组件时一律包一层 `() => void`，项目启用了 no-misused-promises，直传 Promise 返回值会报错。
 */
import { SquarePen } from 'lucide-react'
import { useCallback } from 'react'
import type { AiMentionCandidate, AiReferenceEntry } from '@shared/types/aiChat'
import type { PromptRule } from '@shared/types/promptLibrary'
import { AppAction, AppContent, AppFooter, AppHeader, AppPage, AppTitle } from '@webview/components/AppPage'
import { AppSummary } from '@webview/components/AppSummary'
import { Button } from '@webview/components/Button'
import { useAiChatAutoApprove } from './hooks/useAiChatAutoApprove'
import { useAiChatCommands } from './hooks/useAiChatCommands'
import { useAiChatContexts } from './hooks/useAiChatContexts'
import { useAiChatConversationActions } from './hooks/useAiChatConversationActions'
import { useAiChatDraft } from './hooks/useAiChatDraft'
import { useAiChatEnhance } from './hooks/useAiChatEnhance'
import { useAiChatHistory } from './hooks/useAiChatHistory'
import { useAiChatMention } from './hooks/useAiChatMention'
import { useAiChatModelControl } from './hooks/useAiChatModelControl'
import { useAiChatPageSync } from './hooks/useAiChatPageSync'
import { useAiChatPermission } from './hooks/useAiChatPermission'
import { useAiChatPicker } from './hooks/useAiChatPicker'
import { useAiChatReference } from './hooks/useAiChatReference'
import { useAiChatRuleCatalog } from './hooks/useAiChatRuleCatalog'
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
import { resolveAiChatView } from './utils'
import type { AiReferenceAction } from './constants'
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
    // 增强进行态由输入卡片的 usePromptEnhance 自己维护，页面只提供请求本身
    const { enhance } = useAiChatEnhance()
    const { contexts, setContexts, loadContexts, removeContext } = useAiChatContexts({ onError: setError })
    const { sessions, loadSessions } = useAiChatHistory({ onError: setError, projectDir })
    const { runtime, loadRuntime } = useAiChatRuntime({ onError: setError })
    // 模型控制自带清单拉取与展示名派生：页面只透传一个对象，不再逐项搬 runtime / choices / 回调
    const modelControl = useAiChatModelControl({ runtime, onError: setError })
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
    // 草稿按会话保存：未发送正文与规则防抖写入宿主，快照回填由本 hook 判定是否套用
    const { ruleNames, toggleRule, renameRule, removeRule, applySnapshot, restoreFromMessage } = useAiChatDraft({
        conversationId: session?.conversation.id ?? null,
        input,
        setInput,
    })
    // 规则目录快照：历史消息的规则徽章据此判断「是否已被删除」，规则增删改后刷新
    const { names: availableRuleNames, reload: reloadRuleCatalog } = useAiChatRuleCatalog()
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

    /** 上下文新增成功后重拉会话快照：芯片由宿主维护，前端不本地拼装 */
    const handleContextAdded = useCallback((): void => {
        void loadSession()
    }, [loadSession])

    // 提及检索依赖会话快照的刷新函数，必须排在 useAiChatSession 之后
    const {
        candidates: mentionCandidates,
        isSearching: isMentionSearching,
        search: searchMention,
        add: addMention,
        addPath: addMentionPath,
        reset: resetMention,
    } = useAiChatMention({ onError: setError, onAdded: handleContextAdded })
    // 弹窗开关与「选中成功即关闭并清空候选」的收尾交给 picker，两个检索弹窗共用同一套语义
    const mentionPicker = useAiChatPicker<AiMentionCandidate>({
        items: mentionCandidates,
        isSearching: isMentionSearching,
        search: searchMention,
        add: addMention,
        reset: resetMention,
    })
    const {
        entries: referenceEntries,
        isSearching: isReferenceSearching,
        search: searchReference,
        add: addReference,
        openDir: openReferenceDir,
        reset: resetReference,
    } = useAiChatReference({ onError: setError, onAdded: handleContextAdded })
    const referencePicker = useAiChatPicker<AiReferenceEntry>({
        items: referenceEntries,
        isSearching: isReferenceSearching,
        search: searchReference,
        add: addReference,
        reset: resetReference,
    })
    /** 参考检索入口单取一份：作为依赖时不必把整个 picker 对象拖进回调 */
    const openReferenceSearch = referencePicker.open
    // 连续生成授权：发送成功后的命令清空在此统一收尾
    const {
        pending: pendingAutoApprove,
        submit: submitMessage,
        confirm: confirmAutoApprove,
        dismiss: dismissAutoApprove,
    } = useAiChatAutoApprove({ send })
    // 会话动作的调用顺序（切换成功才套快照）封装在 hook 内，页面不再持有这段时序知识
    const conversation = useAiChatConversationActions({
        startNewSession,
        switchSession,
        deleteSession,
        applySnapshot,
        refreshWriteState: loadWriteState,
    })

    // 展示值一次算齐：消息与滚动锚点、密钥、写入范围、标题与用量文案均由纯函数派生
    const { messages, lastMessageId, hasApiKey, writeGrant, hasWritableScope, title, projectLabel, usageText } =
        resolveAiChatView({ session, runtime, writeState, projectDir, projectTitle })

    /** 参考菜单：检索语料，或打开语料目录（目录不存在时由宿主创建） */
    const handleReference = useCallback(
        (action: AiReferenceAction): void => {
            if (action === 'search') {
                openReferenceSearch()
                return
            }
            void openReferenceDir()
        },
        [openReferenceDir, openReferenceSearch],
    )

    /** 挂载规则：快照里还没有的规则说明目录刚被手改过，顺手刷一次避免徽章误判 */
    const handleToggleRule = useCallback(
        (rule: PromptRule): void => {
            toggleRule(rule)
            if (availableRuleNames !== null && !availableRuleNames.has(rule.name)) {
                void reloadRuleCatalog()
            }
        },
        [availableRuleNames, reloadRuleCatalog, toggleRule],
    )

    /** 规则改名后目录已变，历史徽章要跟着重判 */
    const handleRenameRule = useCallback(
        (previousName: string, rule: PromptRule): void => {
            renameRule(previousName, rule)
            void reloadRuleCatalog()
        },
        [reloadRuleCatalog, renameRule],
    )

    /** 规则删除后目录已变：已挂的摘除，历史徽章转为置灰 */
    const handleRemoveRule = useCallback(
        (ruleName: string): void => {
            removeRule(ruleName)
            void reloadRuleCatalog()
        },
        [reloadRuleCatalog, removeRule],
    )

    /** 发送：正文原样下发，规则随请求携带 */
    const handleSend = useCallback((): void => {
        void submitMessage(input, { writeGrant, ruleNames })
    }, [input, ruleNames, submitMessage, writeGrant])

    return (
        <AppPage>
            <AppHeader>
                <AppTitle>{title}</AppTitle>
                <AppAction>
                    <AiChatHistoryMenu
                        sessions={sessions}
                        activeSessionId={session?.conversation.id}
                        onOpen={() => void loadSessions()}
                        onSwitch={conversation.select}
                        onDelete={conversation.remove}
                    />
                    <Button
                        variant="secondary"
                        size="icon"
                        className="rounded-full"
                        aria-label="新建会话"
                        tooltip="新建会话"
                        onClick={conversation.create}
                    >
                        <SquarePen />
                    </Button>
                </AppAction>
                <AppSummary title={projectLabel} path={projectDir ?? undefined} meta={usageText} />
            </AppHeader>
            <AppContent className="flex h-0 flex-col mb-3">
                <AiChatMessageList
                    messages={messages}
                    lastMessageId={lastMessageId}
                    phase={phase}
                    transientNotice={transientNotice}
                    pendingApproval={pendingPermission}
                    availableRuleNames={availableRuleNames}
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
                    isAwaitingApproval={pendingAutoApprove !== null}
                    ruleNames={ruleNames}
                    onToggleRule={handleToggleRule}
                    onRenameRule={handleRenameRule}
                    onRemoveRule={handleRemoveRule}
                    modelControl={modelControl}
                    onSend={handleSend}
                    onStop={() => void stop()}
                    onRemoveContext={(id) => void removeContext(id)}
                    onReference={handleReference}
                    onMention={mentionPicker.open}
                    onContextAdded={handleContextAdded}
                    onContextError={setError}
                    onEnhanceRequest={enhance}
                    onAddZhaiRef={addMentionPath}
                />
            </AppFooter>
            {/* 自动批准对话 */}
            <AiChatAutoApproveDialog
                pending={pendingAutoApprove}
                onConfirm={confirmAutoApprove}
                onDismiss={dismissAutoApprove}
            />
            {/* 提及检索 */}
            <AiChatMentionDialog
                open={mentionPicker.isOpen}
                candidates={mentionPicker.items}
                isSearching={mentionPicker.isSearching}
                onSearch={(keyword) => void mentionPicker.search(keyword)}
                onPick={(candidate) => void mentionPicker.pick(candidate)}
                onClose={mentionPicker.close}
            />
            {/* 参考语料 */}
            <AiChatReferenceDialog
                open={referencePicker.isOpen}
                entries={referencePicker.items}
                isSearching={referencePicker.isSearching}
                onSearch={(keyword) => void referencePicker.search(keyword)}
                onPick={(entry) => void referencePicker.pick(entry)}
                onClose={referencePicker.close}
            />
        </AppPage>
    )
}
