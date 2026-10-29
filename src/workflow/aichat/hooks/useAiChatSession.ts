/**
 * AI 对话会话状态机：持有会话快照、视图阶段（idle / sending / streaming）与输入内容，
 * 承载发送 / 停止 / 写入范围切换 / 新建 / 切换 / 删除会话等操作，并订阅宿主 stream 消息按发起时的助手消息 id 就地追加增量。
 * 复用 @shared/utils/error 的错误收窄与 ../utils 的消息替换；上下文清单与历史列表由调用方 hook 持有、经参数注入刷新。
 * 关键约束：发送正文由调用方拼装后传入（写作命令模板不进入输入框），本 hook 只负责提交与清空输入；
 * 切换 / 删除会话前先中止生成，避免增量写回已切走的会话；切换写入范围不中断在途生成，只对后续发送生效；
 * 会话作用域由调用方以 projectDir 注入，快照加载 / 新建 / 删除后重载都必须带同一作用域，跨作品不共用对话。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { AiContextRef, AiContextUsage, AiSendResult, AiSessionSnapshot, AiWriteGrant } from '@shared/types/aiChat'
import { onStream, request } from '@shared/utils/bridge'
import { toErrorText } from '@shared/utils/error'
import { patchMessage } from '../utils'

/** 视图阶段：idle 空闲、sending 已提交待首字、streaming 正在逐字生成 */
export type Phase = 'idle' | 'sending' | 'streaming'

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
    /** 正在流式填充的消息 id，避免每次增量都触发状态结构变更 */
    const streamingMessageIdRef = useRef<string | null>(null)
    /** 最新输入正文：草稿恢复时判断本地是否已有内容，避免覆盖用户正在写的内容 */
    const inputRef = useRef('')

    useEffect(() => {
        inputRef.current = input
    }, [input])

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
            // 压缩事件与消息无关：先用 toast 解释，避免占用数字下降被当成数据出错
            if (message.notice === 'compacting') {
                toast.info('上下文正在压缩，较早的历史将被摘要')
                return
            }
            if (message.notice === 'compacted') {
                toast.info('上下文已压缩，占用按压缩后的规模重新计算')
                return
            }
            const messageId = streamingMessageIdRef.current
            if (!messageId) {
                return
            }
            if (message.done) {
                streamingMessageIdRef.current = null
                setPhase('idle')
                setActiveTool(null)
                // 上下文占用只在流末下发一次，未回传时保留上一次的值
                const nextContextUsage = readContextUsage(message.contextUsage)
                if (nextContextUsage !== null) {
                    setContextUsage(nextContextUsage)
                }
                setSession((previous) =>
                    patchMessage(previous, messageId, (item) => ({
                        ...item,
                        content: message.content ?? item.content,
                        status: message.status ?? 'completed',
                        error: message.error ?? null,
                        // 用量与耗时只在流末下发一次，字段逐个收窄后再并入，缺省保留原值
                        totalTokens: readStreamNumber(message.usage?.totalTokens, item.totalTokens),
                        durationMs: readStreamNumber(message.durationMs, item.durationMs),
                        tokensEstimated: message.tokensEstimated === true,
                        credits: readStreamCredits(message.credits, item.credits),
                    })),
                )
                if (message.error) {
                    onError(message.error)
                }
                return
            }
            if (message.tool !== undefined) {
                // 工具活动是旁路事件：只更新进度，不追加正文
                setActiveTool(message.tool)
                return
            }
            if (message.delta.length === 0) {
                return
            }
            setSession((previous) =>
                patchMessage(previous, messageId, (item) => ({ ...item, content: item.content + message.delta })),
            )
        })
    }, [onError])

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
                return false
            }
        },
        [onError, phase, session, setContexts],
    )

    const stop = useCallback(async (): Promise<void> => {
        try {
            await request('ai/abort')
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
