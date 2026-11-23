/**
 * AI 对话会话状态机：持有会话快照、视图阶段（idle / sending / streaming）与输入内容，
 * 承载发送 / 停止 / 新建 / 切换 / 删除会话等操作，并订阅宿主 stream 消息按发起时的助手消息 id 就地追加增量。
 * 复用 @shared/utils/error 的错误收窄与 ../utils/chat/session 的消息替换；流消息的归一与字段收窄集中在 ../utils/chat/stream，
 * 上下文清单与历史列表由调用方 hook 持有、经参数注入刷新。
 * 关键约束：发送正文由调用方拼装后传入（写作命令模板不进入输入框），本 hook 只负责提交与清空输入；
 * 增量按 channel 分流——content 追加到正文、reasoning 追加到思维链，两者不混流；流末以宿主回传的完整值校正；
 * 流末错误只写回消息、由消息视图的 Alert 呈现，不弹 sonner —— 同一句话弹两遍是噪音；
 * 压缩事件分两态——开始时只置瞬时状态（不落库），完成时追加宿主已落库的系统消息，保证离线回看仍能解释占用变化；
 * 会话选择（新建 / 切换 / 删除当前）共用一个序号，先发后到的快照不得覆盖用户的最后一次选择；
 * 切换 / 删除会话前先中止生成，避免增量写回已切走的会话；新建会话不中止后台生成，
 * 但必须摘掉旧会话的流锚点并复位阶段，否则新会话会被上一轮的生成态一直锁住；
 * 生成由宿主推进、与页面生命周期无关：切分区、切文档（含跨作用域换会话）都不中断生成，重进时按快照里的
 * 在途消息接管流式锚点，并回拉 ai/streaming 的在途快照补齐离开期间缺失的正文与思维链；
 * 在途生成属于别的会话时只放出停止入口，尚未接管到锚点的流末直接回拉会话快照，
 * 避免回到页面后停在占位态、丢失停止入口；
 * 会话作用域由调用方以 projectDir 注入，快照加载 / 新建 / 删除后重载都必须带同一作用域——
 * 作用域粒度由 contentScope.readScopeDir 决定（微博 / 笔记文档 / 作品 / 公众号批次），跨作用域不共用。
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
} from '@shared/types/aiChat'
import { onStream, request } from '@shared/utils/bridge'
import { toErrorText } from '@shared/utils/error'
import type { Phase } from '../utils/chat/view'
import { patchMessage, upsertStep } from '../utils/chat/session'
import { appendNoticeMessage, applyDonePatch, readContextUsage, readStreamEvent } from '../utils/chat/stream'

/** 视图阶段定义在展示层 utils/chat/view，此处转出保持既有引用路径不变 */
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
    /** 会话作用域（模块键 / 文档路径 / 作品目录 / 公众号批次目录）：同一作用域共用一份记录，null 为通用对话 */
    projectDir: string | null
}

/** 发送选项：titleHint 为命令名称等展示用短标题，ruleNames 为本轮挂载的规则 */
export interface AiSendOptions {
    titleHint?: string
    /** 本轮挂载的规则名：由宿主读正文并入提示词，不占上下文配额 */
    ruleNames?: readonly string[]
    /** 本轮挂载的参考图路径：宿主按登记表校验后以图片块提交，供模型识图 */
    referenceImages?: readonly string[]
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
    /** 新建会话：返回是否切换成功，失败时调用方保留输入与已选命令 */
    startNewSession: () => Promise<boolean>
    /** 切换会话：返回快照供调用方恢复草稿中的命令（未切换、失败或被更新的选择取代时返回 null） */
    switchSession: (conversationId: string) => Promise<AiSessionSnapshot | null>
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
    /**
     * 会话选择序号：新建 / 切换 / 删除当前会话都会递增，
     * 连点多个入口时只采纳最后一次，先发后到的快照不得覆盖用户的最新选择。
     */
    const sessionSeqRef = useRef(0)
    /**
     * 停止计数：send 提交后、响应返回前用户点了停止（sending 阶段也能停），
     * 响应晚到不得把阶段再推回生成中，否则界面会停在无人推进的流式态。
     */
    const stopEpochRef = useRef(0)

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
            const event = readStreamEvent(message)
            if (event.kind === 'ignore') {
                return
            }
            // 压缩事件走流内标记：开始时只置瞬时状态，完成时追加宿主已落库的系统消息。
            // 不再用 toast —— 提示转瞬即逝，重开面板后无法解释占用为何变小。
            if (event.kind === 'compacting') {
                setTransientNotice('compacting')
                return
            }
            if (event.kind === 'compacted') {
                setTransientNotice(null)
                const notice = event.notice
                // 按 id 去重：快照刷新与流内追加可能命中同一条，重复会让分隔标记出现两次
                if (notice !== null) {
                    setSession((previous) => appendNoticeMessage(previous, notice))
                }
                return
            }
            const messageId = streamingMessageIdRef.current
            if (!messageId) {
                // 没有接管的在途锚点（如视图重建早于快照、或本轮属于别的会话）：本页无法归位增量，
                // 流末复位阶段并回拉快照补齐结果，避免残留的生成中态把发送一直拦住
                if (event.kind === 'done') {
                    setPhase('idle')
                    setActiveTool(null)
                    setTransientNotice(null)
                    void loadSession()
                }
                return
            }
            if (event.kind === 'done') {
                streamingMessageIdRef.current = null
                setPhase('idle')
                setActiveTool(null)
                setTransientNotice(null)
                // 上下文占用只在流末下发一次，未回传时保留上一次的值
                const nextContextUsage = readContextUsage(message.contextUsage)
                if (nextContextUsage !== null) {
                    setContextUsage(nextContextUsage)
                }
                setSession((previous) => patchMessage(previous, messageId, (item) => applyDonePatch(item, message)))
                // 错误原文已随消息落库、由消息视图的 Alert 内联呈现；这里再弹一次 sonner 就是重复提醒
                return
            }
            if (event.kind === 'tool') {
                // 工具活动是旁路事件：只更新进度，不追加正文
                setActiveTool(event.tool)
                return
            }
            if (event.kind === 'step') {
                // 步骤快照按 id 覆盖：同一步骤会经历排队 / 执行中 / 完成三次下发，以最后一次为准
                setSession((previous) =>
                    patchMessage(previous, messageId, (item) => ({
                        ...item,
                        steps: upsertStep(item.steps, event.step),
                    })),
                )
                return
            }
            // 思维链与正文分通道下发：reasoning 只进思维链字段，不污染消息正文
            const isReasoning = event.channel === 'reasoning'
            setSession((previous) =>
                patchMessage(previous, messageId, (item) =>
                    isReasoning
                        ? { ...item, reasoning: (item.reasoning ?? '') + event.delta }
                        : { ...item, content: item.content + event.delta },
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
            /** 本轮提交时的停止计数：响应返回后据此判断这一轮是否已被用户中止 */
            const epoch = stopEpochRef.current
            try {
                const result = await request<AiSendResult>('ai/send', {
                    conversationId: session.conversation.id,
                    content: text,
                    titleHint: options.titleHint,
                    ruleNames: options.ruleNames ?? [],
                    referenceImages: options.referenceImages ?? [],
                })
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
                if (result.skippedRules.length > 0) {
                    toast.info(`已跳过超长或不可读的规则：${result.skippedRules.join('、')}`)
                }
                // 等待期间用户点了停止：消息照常入列，但不再挂流锚点、不把阶段推回生成中
                // （否则宿主的流末已过去，界面会停在无人推进的流式态），也不清空输入
                // —— 停止后用户可能已经重新输入，晚到的响应不能把它抹掉
                if (stopEpochRef.current !== epoch) {
                    streamingMessageIdRef.current = null
                    return true
                }
                setInput('')
                streamingMessageIdRef.current = result.assistantMessage.id
                setPhase('streaming')
                return true
            } catch (cause) {
                // 用户主动停止时宿主以中止错误收尾，再提示一遍是噪音
                if (stopEpochRef.current === epoch) {
                    onError(toErrorText(cause))
                }
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
        // 先记账再请求：sending 阶段的 send 响应可能晚于本次停止返回，靠它判定本轮已中止
        stopEpochRef.current += 1
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

    const startNewSession = useCallback(async (): Promise<boolean> => {
        // 新建同样占用「当前会话」选择位：飞行的切换 / 删除不得再覆盖这个新会话
        const seq = sessionSeqRef.current + 1
        sessionSeqRef.current = seq
        try {
            const snapshot = await request<AiSessionSnapshot>('ai/newSession', { projectDir })
            if (sessionSeqRef.current !== seq) {
                return false
            }
            setSession(snapshot)
            setContexts(snapshot.contexts)
            setContextUsage(snapshot.contextUsage)
            setTransientNotice(null)
            setInput('')
            /*
             * 新会话没有在途生成：清掉旧会话的流锚点并复位阶段。
             * 宿主新建会话不中止后台生成，但那一轮属于上一份记录，前端不能继续挂着它的生成态 ——
             * 否则新会话的输入区与发送会被一直锁住，直到旧流自然结束。
             */
            streamingMessageIdRef.current = null
            setActiveTool(null)
            setPhase('idle')
            onError(null)
            return true
        } catch (cause) {
            onError(toErrorText(cause))
            return false
        }
    }, [onError, projectDir, setContexts])

    /** 切换到历史会话：生成中先停止再切换，避免增量写回已切走的会话；输入框内容保持不动 */
    const switchSession = useCallback(
        async (conversationId: string): Promise<AiSessionSnapshot | null> => {
            // 每次点击都递增（含点回当前会话）：先发后到的快照不得覆盖用户最后一次的选择
            const seq = sessionSeqRef.current + 1
            sessionSeqRef.current = seq
            if (session?.conversation.id === conversationId) {
                return null
            }
            try {
                if (phase !== 'idle') {
                    await request('ai/abort')
                }
                const snapshot = await request<AiSessionSnapshot>('ai/switchSession', { conversationId })
                if (sessionSeqRef.current !== seq) {
                    return null
                }
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
                    const seq = sessionSeqRef.current + 1
                    sessionSeqRef.current = seq
                    streamingMessageIdRef.current = null
                    setPhase('idle')
                    const snapshot = await request<AiSessionSnapshot>('ai/session', { projectDir })
                    // 重载期间用户已选别的会话：以那次选择为准，不回填被删会话的旧快照
                    if (sessionSeqRef.current === seq) {
                        setSession(snapshot)
                        setContexts(snapshot.contexts)
                        setContextUsage(snapshot.contextUsage)
                        setTransientNotice(null)
                        onError(null)
                    }
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
