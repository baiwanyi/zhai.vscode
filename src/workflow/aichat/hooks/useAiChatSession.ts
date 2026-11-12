/**
 * AI 对话会话状态机：持有会话快照、视图阶段（idle / sending / streaming）与输入内容，
 * 承载发送 / 停止 / 写入范围切换 / 新建 / 切换 / 删除会话等操作，并订阅宿主 stream 消息按发起时的助手消息 id 就地追加增量。
 * 复用 @shared/utils/error 的错误收窄与 ../utils 的消息替换；上下文清单与历史列表由调用方 hook 持有、经参数注入刷新。
 * 关键约束：发送正文由调用方拼装后传入（写作命令模板不进入输入框），本 hook 只负责提交与清空输入；
 * 增量按 channel 分流——content 追加到正文、reasoning 追加到思维链，两者不混流；流末以宿主回传的完整值校正；
 * 流末错误只写回消息、由消息视图的 Alert 呈现，不弹 sonner —— 同一句话弹两遍是噪音；
 * 压缩事件分两态——开始时只置瞬时状态（不落库），完成时追加宿主已落库的系统消息，保证离线回看仍能解释占用变化；
 * 切换 / 删除会话前先中止生成，避免增量写回已切走的会话；切换写入范围不中断在途生成，只对后续发送生效；
 * 生成由宿主推进、与页面生命周期无关：切分区、切文档（含跨作用域换会话）都不中断生成，重进时按快照里的
 * 在途消息接管流式锚点，并回拉 ai/streaming 的在途快照补齐离开期间缺失的正文与思维链；
 * 在途生成属于别的会话时只放出停止入口，尚未接管到锚点的流末直接回拉会话快照，
 * 避免回到页面后停在占位态、丢失停止入口；
 * 会话作用域由调用方以 projectDir 注入，快照加载 / 新建 / 删除后重载都必须带同一作用域，跨作品不共用对话。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { readAiStep } from '@shared/types/aiChat'
import type {
    AiContextRef,
    AiContextUsage,
    AiInFlightSnapshot,
    AiMessage,
    AiSendResult,
    AiSessionSnapshot,
    AiStep,
    AiWriteGrant,
} from '@shared/types/aiChat'
import type { StreamNoticeMessage } from '@shared/types/messages'
import { onStream, request } from '@shared/utils/bridge'
import { toErrorText } from '@shared/utils/error'
import { patchMessage, upsertStep, type Phase } from '../utils'

/** 视图阶段定义在展示层 utils，此处转出保持既有引用路径不变 */
export type { Phase }

/** 会话级瞬时状态：只描述此刻正在发生什么，不落库，随流末清空 */
export type AiChatTransientNotice = 'compacting' | null

/** 会话状态机的对外依赖：错误由共享提示 hook 持有，上下文与历史列表由调用方 hook 持有 */
export interface UseAiChatSessionOptions {
    onError: (error: string | null) => void
    /** 快照加载 / 会话切换后同步待发送上下文清单 */
    setContexts: (contexts: AiContextRef[]) => void
    /** 删除会话后刷新历史列表 */
    refreshSessions: () => Promise<void>
    /** 会话作用域（作品目录）：同一作品共用一份对话记录，null 表示不属于任何作品的通用对话 */
    projectDir: string | null
}

/** 发送选项：autoApprove 为本轮写入授权，titleHint 为命令名称等展示用短标题 */
export interface AiSendOptions {
    /** 本轮是否允许白名单内直接写入：仅在连续生成确认后为 true */
    autoApprove?: boolean
    titleHint?: string
}

/** 会话状态机对外暴露的状态与操作 */
export interface AiChatSessionState {
    session: AiSessionSnapshot | null
    phase: Phase
    input: string
    setInput: (input: string) => void
    /** 当前会话上下文占用：由会话快照初始化，流末按通道回传更新，null 表示尚无数据 */
    contextUsage: AiContextUsage | null
    /** 正在调用的工具名：null 表示当前没有工具执行，仅用于展示进度 */
    activeTool: string | null
    /** 会话级瞬时状态：非 null 时在消息流末尾展示对应标记，流末自动清空 */
    transientNotice: AiChatTransientNotice
    /** 加载会话快照：返回快照供调用方恢复草稿中的命令（失败返回 null） */
    loadSession: () => Promise<AiSessionSnapshot | null>
    /** 提交已拼装的正文；返回是否成功发出，失败时调用方保留输入与已选命令 */
    send: (content: string, options?: AiSendOptions) => Promise<boolean>
    stop: () => Promise<void>
    startNewSession: () => Promise<void>
    /** 切换会话：返回快照供调用方恢复草稿中的命令（未切换或失败返回 null） */
    switchSession: (conversationId: string) => Promise<AiSessionSnapshot | null>
    /** 切换写入授权范围：只影响后续发送下发的写入白名单 */
    switchWriteGrant: (grant: AiWriteGrant) => Promise<void>
    deleteSession: (conversationId: string) => Promise<void>
}

export function useAiChatSession({
    onError,
    setContexts,
    refreshSessions,
    projectDir,
}: UseAiChatSessionOptions): AiChatSessionState {
    const [session, setSession] = useState<AiSessionSnapshot | null>(null)
    const [phase, setPhase] = useState<Phase>('idle')
    const [input, setInput] = useState('')
    const [contextUsage, setContextUsage] = useState<AiContextUsage | null>(null)
    /** 正在调用的工具名：工具执行期间展示进度，流末清空 */
    const [activeTool, setActiveTool] = useState<string | null>(null)
    /** 会话级瞬时状态：压缩进行中时置位，完成或流末清空，不落库 */
    const [transientNotice, setTransientNotice] = useState<AiChatTransientNotice>(null)
    /** 正在流式填充的消息 id，避免每次增量都触发状态结构变更 */
    const streamingMessageIdRef = useRef<string | null>(null)
    /** 最新输入正文：草稿恢复时判断本地是否已有内容，避免覆盖用户正在写的内容 */
    const inputRef = useRef('')
    /** 最新视图阶段：loadSession 会在异步流程里被调用，state 可能滞后，用 ref 取提交后的值 */
    const phaseRef = useRef<Phase>('idle')

    useEffect(() => {
        inputRef.current = input
    }, [input])

    useEffect(() => {
        phaseRef.current = phase
    }, [phase])

    /** 恢复宿主带回的草稿：本地已有输入或草稿为空时跳过 */
    const restoreDraft = useCallback((draft: string): void => {
        if (draft.length === 0 || inputRef.current.length > 0) {
            return
        }
        inputRef.current = draft
        setInput(draft)
    }, [])

    const loadSession = useCallback(async (): Promise<AiSessionSnapshot | null> => {
        try {
            const snapshot = await request<AiSessionSnapshot>('ai/session', { projectDir })
            setSession(snapshot)
            setContexts(snapshot.contexts)
            setContextUsage(snapshot.contextUsage)
            restoreDraft(snapshot.draft.input)
            /*
             * 与宿主在途生成对账：生成由宿主推进、与页面生命周期无关，切换文档（乃至跨作用域换会话）都不中断。
             * 三种结果分开处理 —— 属于本会话就补挂锚点并回填离开期间缺失的正文与思维链；
             * 属于别的会话时消息流里没有锚点可挂，只把阶段置为生成中，让停止入口可用（否则发送被宿主拒绝又停不掉）；
             * 没有在途请求则说明快照里的 pending 只是残留占位，把本地阶段复位。
             * 只在本地空手（未发送、无在途锚点）时对账，避免覆盖本地更权威的阶段。
             */
            const inFlightId = readInFlightMessageId(snapshot)
            if (streamingMessageIdRef.current === null && phaseRef.current !== 'sending') {
                const inFlight = await readInFlight()
                if (
                    inFlight !== null &&
                    inFlightId !== null &&
                    inFlight.conversationId === snapshot.conversation.id &&
                    inFlight.messageId === inFlightId
                ) {
                    streamingMessageIdRef.current = inFlightId
                    setPhase('streaming')
                    setSession((previous) =>
                        patchMessage(previous, inFlightId, (item) => mergeInFlight(item, inFlight)),
                    )
                } else if (inFlight !== null) {
                    setPhase('streaming')
                } else if (phaseRef.current !== 'idle') {
                    setPhase('idle')
                    setActiveTool(null)
                }
            }
            onError(null)
            return snapshot
        } catch (cause) {
            onError(toErrorText(cause))
            return null
        }
    }, [onError, projectDir, restoreDraft, setContexts])

    // 流式增量：按 reqId 找到发起时的助手消息并就地追加
    useEffect(() => {
        return onStream((message) => {
            // 压缩事件走流内标记：开始时只置瞬时状态，完成时追加宿主已落库的系统消息。
            // 不再用 toast —— 提示转瞬即逝，重开面板后无法解释占用为何变小。
            if (message.notice === 'compacting') {
                setTransientNotice('compacting')
                return
            }
            if (message.notice === 'compacted') {
                setTransientNotice(null)
                const notice = message.noticeMessage
                if (notice !== undefined) {
                    setSession((previous) => {
                        // 按 id 去重：快照刷新与流内追加可能命中同一条，重复会让分隔标记出现两次
                        if (previous === null || previous.messages.some((item) => item.id === notice.id)) {
                            return previous
                        }
                        return {
                            ...previous,
                            messages: [...previous.messages, toNoticeMessage(previous.conversation.id, notice)],
                        }
                    })
                }
                return
            }
            const messageId = streamingMessageIdRef.current
            if (!messageId) {
                // 没有接管的在途锚点（如视图重建早于快照、或本轮属于别的会话）：本页无法归位增量，
                // 流末复位阶段并回拉快照补齐结果，避免残留的生成中态把发送一直拦住
                if (message.done) {
                    setPhase('idle')
                    setActiveTool(null)
                    setTransientNotice(null)
                    void loadSession()
                }
                return
            }
            if (message.done) {
                streamingMessageIdRef.current = null
                setPhase('idle')
                setActiveTool(null)
                setTransientNotice(null)
                // 上下文占用只在流末下发一次，未回传时保留上一次的值
                const nextContextUsage = readContextUsage(message.contextUsage)
                if (nextContextUsage !== null) {
                    setContextUsage(nextContextUsage)
                }
                setSession((previous) =>
                    patchMessage(previous, messageId, (item) => ({
                        ...item,
                        content: message.content ?? item.content,
                        // 思维链同口径校正：未回传时保留逐字累积结果
                        reasoning: message.reasoning ?? item.reasoning,
                        status: message.status ?? 'completed',
                        error: message.error ?? null,
                        // 用量与耗时只在流末下发一次，字段逐个收窄后再并入，缺省保留原值
                        totalTokens: readStreamNumber(message.usage?.totalTokens, item.totalTokens),
                        durationMs: readStreamNumber(message.durationMs, item.durationMs),
                        tokensEstimated: message.tokensEstimated === true,
                        credits: readStreamCredits(message.credits, item.credits),
                    })),
                )
                // 错误原文已随消息落库、由消息视图的 Alert 内联呈现；这里再弹一次 sonner 就是重复提醒
                return
            }
            if (message.tool !== undefined) {
                // 工具活动是旁路事件：只更新进度，不追加正文
                setActiveTool(message.tool)
                return
            }
            if (message.step !== undefined) {
                // 步骤快照按 id 覆盖：同一步骤会经历排队 / 执行中 / 完成三次下发，以最后一次为准
                const step = readAiStep(message.step)
                if (step !== null) {
                    setSession((previous) =>
                        patchMessage(previous, messageId, (item) => ({ ...item, steps: upsertStep(item.steps, step) })),
                    )
                }
                return
            }
            if (message.delta.length === 0) {
                return
            }
            // 思维链与正文分通道下发：reasoning 只进思维链字段，不污染消息正文
            const isReasoning = message.channel === 'reasoning'
            setSession((previous) =>
                patchMessage(previous, messageId, (item) =>
                    isReasoning
                        ? { ...item, reasoning: (item.reasoning ?? '') + message.delta }
                        : { ...item, content: item.content + message.delta },
                ),
            )
        })
    }, [loadSession, onError])

    const send = useCallback(
        async (content: string, options: AiSendOptions = {}): Promise<boolean> => {
            const text = content.trim()
            if (text.length === 0 || !session || phase !== 'idle') {
                return false
            }
            setPhase('sending')
            onError(null)
            try {
                const result = await request<AiSendResult>('ai/send', {
                    conversationId: session.conversation.id,
                    content: text,
                    autoApprove: options.autoApprove === true,
                    titleHint: options.titleHint,
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
                    toast.info(`已跳过失效引用：${result.skippedContexts.join('、')}`)
                }
                setInput('')
                setPhase('streaming')
                return true
            } catch (cause) {
                onError(toErrorText(cause))
                setPhase('idle')
                // 失败原因可能是宿主仍在生成（切换文档后旧会话尚未结束）：回拉快照把停止入口恢复出来
                void loadSession()
                return false
            }
        },
        [loadSession, onError, phase, session, setContexts],
    )

    /** 取消本轮生成：宿主已无在途请求时（接管到的只是残留占位）就地复位阶段，别把发送一直拦住 */
    const stop = useCallback(async (): Promise<void> => {
        try {
            const result = await request<{ aborted?: boolean }>('ai/abort')
            if (result.aborted !== true) {
                streamingMessageIdRef.current = null
                setPhase('idle')
            }
        } catch (cause) {
            onError(toErrorText(cause))
        }
    }, [onError])

    const startNewSession = useCallback(async (): Promise<void> => {
        try {
            const snapshot = await request<AiSessionSnapshot>('ai/newSession', { projectDir })
            setSession(snapshot)
            setContexts(snapshot.contexts)
            setContextUsage(snapshot.contextUsage)
            setTransientNotice(null)
            setInput('')
            onError(null)
        } catch (cause) {
            onError(toErrorText(cause))
        }
    }, [onError, projectDir, setContexts])

    /** 切换写入范围：不中断在途生成，新范围只对后续发送生效 */
    const switchWriteGrant = useCallback(
        async (grant: AiWriteGrant): Promise<void> => {
            if (!session || session.conversation.writeGrant === grant) {
                return
            }
            try {
                const result = await request<{ writeGrant: AiWriteGrant }>('ai/setWriteGrant', {
                    writeGrant: grant,
                })
                setSession((previous) =>
                    previous
                        ? { ...previous, conversation: { ...previous.conversation, writeGrant: result.writeGrant } }
                        : previous,
                )
                onError(null)
            } catch (cause) {
                onError(toErrorText(cause))
            }
        },
        [onError, session],
    )

    /** 切换到历史会话：生成中先停止再切换，避免增量写回已切走的会话；输入框内容保持不动 */
    const switchSession = useCallback(
        async (conversationId: string): Promise<AiSessionSnapshot | null> => {
            if (session?.conversation.id === conversationId) {
                return null
            }
            try {
                if (phase !== 'idle') {
                    await request('ai/abort')
                }
                const snapshot = await request<AiSessionSnapshot>('ai/switchSession', { conversationId })
                streamingMessageIdRef.current = null
                setSession(snapshot)
                setContexts(snapshot.contexts)
                setContextUsage(snapshot.contextUsage)
                setTransientNotice(null)
                restoreDraft(snapshot.draft.input)
                setPhase('idle')
                onError(null)
                return snapshot
            } catch (cause) {
                onError(toErrorText(cause))
                return null
            }
        },
        [onError, phase, restoreDraft, session, setContexts],
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
                    const snapshot = await request<AiSessionSnapshot>('ai/session', { projectDir })
                    setSession(snapshot)
                    setContexts(snapshot.contexts)
                    setContextUsage(snapshot.contextUsage)
                    setTransientNotice(null)
                    onError(null)
                }
                await refreshSessions()
            } catch (cause) {
                onError(toErrorText(cause))
            }
        },
        [onError, projectDir, refreshSessions, session, setContexts],
    )

    return {
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
    }
}

/**
 * 找出快照里仍在生成的消息：宿主只在发送时落 pending，流末统一改成终态，
 * 因此「还有 assistant 消息处于 pending / streaming」即表示本轮尚未结束。
 * 关键约束：取最后一条命中项 —— 压缩产生的系统消息可能追加在生成中的助手消息之后。
 */
function readInFlightMessageId(snapshot: AiSessionSnapshot): string | null {
    let inFlightId: string | null = null
    for (const message of snapshot.messages) {
        if (message.role === 'assistant' && (message.status === 'pending' || message.status === 'streaming')) {
            inFlightId = message.id
        }
    }
    return inFlightId
}

/**
 * 读取宿主在途生成快照：视图重建后补齐离开期间被丢弃的正文、思维链与步骤，
 * 同时用于判断「在途生成是否属于当前会话」——切换文档后它可能属于刚离开的那个会话。
 * 关键约束：请求失败只是退化为「只显示重连之后的部分」，不得让会话加载整体失败；
 * 会话与消息 id 缺一即视为无效快照，其余字段逐项收窄（Webview 侧数据不可信）。
 */
async function readInFlight(): Promise<AiInFlightSnapshot | null> {
    try {
        const payload = await request<unknown>('ai/streaming')
        if (typeof payload !== 'object' || payload === null) {
            return null
        }
        const record = payload as {
            conversationId?: unknown
            messageId?: unknown
            content?: unknown
            reasoning?: unknown
            steps?: unknown
        }
        const { conversationId, messageId } = record
        if (typeof conversationId !== 'string' || conversationId.length === 0) {
            return null
        }
        if (typeof messageId !== 'string' || messageId.length === 0) {
            return null
        }
        return {
            conversationId,
            messageId,
            content: typeof record.content === 'string' ? record.content : '',
            reasoning: typeof record.reasoning === 'string' ? record.reasoning : '',
            steps: Array.isArray(record.steps)
                ? record.steps.map((item) => readAiStep(item)).filter((item): item is AiStep => item !== null)
                : [],
        }
    } catch {
        return null
    }
}

/**
 * 把在途快照并入待展示消息：快照是「截至读取时刻」的累积值，
 * 若本地已在此基础上有新增量则保留本地，避免回填与增量推送交错时把刚到的几个字覆盖掉；
 * 最终仍以流末的完整值校正，缺口不会残留到结束之后。
 */
function mergeInFlight(message: AiMessage, snapshot: AiInFlightSnapshot): AiMessage {
    const reasoning = preferLonger(message.reasoning ?? '', snapshot.reasoning)
    return {
        ...message,
        content: preferLonger(message.content, snapshot.content),
        reasoning: reasoning.length > 0 ? reasoning : message.reasoning,
        steps: snapshot.steps.length > 0 ? snapshot.steps : message.steps,
    }
}

/** 取同源增长中更长的那份：本地以快照为前缀时说明已接到新增量，否则用快照补齐缺口 */
function preferLonger(current: string, incoming: string): string {
    return current.length > incoming.length && current.startsWith(incoming) ? current : incoming
}

/**
 * 系统事件消息转展示消息：宿主只下发展示与去重需要的字段，其余按「无推理、无引用、无用量」补齐。
 * 关键约束：status 恒为 completed —— 系统消息没有在途态，误判会出现多余的加载占位。
 */
function toNoticeMessage(conversationId: string, notice: StreamNoticeMessage): AiMessage {
    return {
        id: notice.id,
        conversationId,
        role: 'system',
        content: notice.content,
        reasoning: null,
        steps: [],
        status: 'completed',
        finishReason: notice.kind,
        error: null,
        refs: [],
        totalTokens: 0,
        durationMs: 0,
        tokensEstimated: false,
        credits: null,
        createdAt: notice.createdAt,
    }
}

/**
 * 流末数值收窄：Webview 侧收到的字段不可信，非有限数或负数一律视为未知，
 * 沿用消息上已有的值（历史消息为 0，渲染层据此不展示）。
 */
function readStreamNumber(value: number | undefined, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

/** 流末积分收窄：null 是「明确未知」而不是 0，原样并入；缺省（undefined）沿用原值 */
function readStreamCredits(credits: number | null | undefined, fallback: number | null): number | null {
    return typeof credits === 'number' && Number.isFinite(credits) ? credits : fallback
}

/**
 * 流末上下文用量收窄：Webview 侧数据不可信，两项都必须是有限非负数才采纳；
 * 任一不合格返回 null 表示未回传，由调用方保留上一次的值。
 */
function readContextUsage(value: unknown): AiContextUsage | null {
    if (typeof value !== 'object' || value === null) {
        return null
    }
    const { usedTokens, windowTokens } = value as { usedTokens?: unknown; windowTokens?: unknown }
    if (typeof usedTokens !== 'number' || !Number.isFinite(usedTokens) || usedTokens < 0) {
        return null
    }
    if (typeof windowTokens !== 'number' || !Number.isFinite(windowTokens) || windowTokens < 0) {
        return null
    }
    return { usedTokens, windowTokens }
}
