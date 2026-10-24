/**
 * AI 对话会话状态机：持有会话快照、视图阶段（idle / sending / streaming）与输入内容，
 * 承载发送 / 停止 / 模式切换 / 新建 / 切换 / 删除会话等操作，并订阅宿主 stream 消息按发起时的助手消息 id 就地追加增量。
 * 复用 ../utils 的消息替换与错误收窄；上下文清单与历史列表由调用方 hook 持有、经参数注入刷新。
 * 关键约束：发送正文由调用方拼装后传入（写作命令模板不进入输入框），本 hook 只负责提交与清空输入；
 * 切换 / 删除会话或切换模式前先中止生成，避免增量写回已切走的会话；输入框内容在切换时保持不动；
 * 会话作用域由调用方以 projectDir 注入，快照加载 / 新建 / 删除后重载都必须带同一作用域，跨作品不共用对话。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { AiContextRef, AiConversationMode, AiSendResult, AiSessionSnapshot } from '@shared/types/aiChat'
import { onStream, request } from '@shared/utils/bridge'
import type { AiApplyPolicy } from '../constants'
import { patchMessage, toErrorText } from '../utils'

/** 视图阶段：idle 空闲、sending 已提交待首字、streaming 正在逐字生成 */
export type Phase = 'idle' | 'sending' | 'streaming'

/** 会话状态机的对外依赖：错误 / 提示由共享提示 hook 持有，上下文与历史列表由调用方 hook 持有 */
export interface UseAiChatSessionOptions {
    onError: (error: string | null) => void
    onNotice: (notice: string | null) => void
    /** 快照加载 / 会话切换后同步待发送上下文清单 */
    setContexts: (contexts: AiContextRef[]) => void
    /** 删除会话后刷新历史列表 */
    refreshSessions: () => Promise<void>
    /** 会话作用域（作品目录）：同一作品共用一份对话记录，null 表示不属于任何作品的通用对话 */
    projectDir: string | null
}

/** 发送选项：applyPolicy 决定本轮结果是否提供写回入口，titleHint 为命令名称等展示用短标题 */
export interface AiSendOptions {
    applyPolicy?: AiApplyPolicy
    titleHint?: string
}

/** 会话状态机对外暴露的状态与操作 */
export interface AiChatSessionState {
    session: AiSessionSnapshot | null
    phase: Phase
    input: string
    setInput: (input: string) => void
    /** 加载会话快照：返回快照供调用方恢复草稿中的命令（失败返回 null） */
    loadSession: () => Promise<AiSessionSnapshot | null>
    /** 提交已拼装的正文；返回是否成功发出，失败时调用方保留输入与已选命令 */
    send: (content: string, options?: AiSendOptions) => Promise<boolean>
    stop: () => Promise<void>
    startNewSession: () => Promise<void>
    /** 切换会话：返回快照供调用方恢复草稿中的命令（未切换或失败返回 null） */
    switchSession: (conversationId: string) => Promise<AiSessionSnapshot | null>
    switchMode: (mode: AiConversationMode) => Promise<void>
    deleteSession: (conversationId: string) => Promise<void>
}

export function useAiChatSession({
    onError,
    onNotice,
    setContexts,
    refreshSessions,
    projectDir,
}: UseAiChatSessionOptions): AiChatSessionState {
    const [session, setSession] = useState<AiSessionSnapshot | null>(null)
    const [phase, setPhase] = useState<Phase>('idle')
    const [input, setInput] = useState('')
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
            const messageId = streamingMessageIdRef.current
            if (!messageId) {
                return
            }
            if (message.done) {
                streamingMessageIdRef.current = null
                setPhase('idle')
                setSession((previous) =>
                    patchMessage(previous, messageId, (item) => ({
                        ...item,
                        content: message.content ?? item.content,
                        status: message.status ?? 'completed',
                        error: message.error ?? null,
                    })),
                )
                if (message.error) {
                    onError(message.error)
                }
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
            onNotice(null)
            try {
                const result = await request<AiSendResult>('ai/send', {
                    conversationId: session.conversation.id,
                    content: text,
                    applyPolicy: options.applyPolicy ?? 'replace',
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
        [onError, onNotice, phase, session, setContexts],
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
            setInput('')
            onError(null)
            onNotice(null)
        } catch (cause) {
            onError(toErrorText(cause))
        }
    }, [onError, onNotice, projectDir, setContexts])

    /** 切换会话模式：生成中先停止，宿主写库后同步本地快照；模式只影响后续发送与结果处置 */
    const switchMode = useCallback(
        async (mode: AiConversationMode): Promise<void> => {
            if (!session || session.conversation.mode === mode) {
                return
            }
            try {
                if (phase !== 'idle') {
                    await request('ai/abort')
                }
                const result = await request<{ mode: AiConversationMode }>('ai/setMode', { mode })
                setSession((previous) =>
                    previous
                        ? { ...previous, conversation: { ...previous.conversation, mode: result.mode } }
                        : previous,
                )
                setPhase('idle')
                onError(null)
                onNotice(null)
            } catch (cause) {
                onError(toErrorText(cause))
            }
        },
        [onError, onNotice, phase, session],
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
                restoreDraft(snapshot.draft.input)
                setPhase('idle')
                onError(null)
                onNotice(null)
                return snapshot
            } catch (cause) {
                onError(toErrorText(cause))
                return null
            }
        },
        [onError, onNotice, phase, restoreDraft, session, setContexts],
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
                    onError(null)
                    onNotice(null)
                }
                await refreshSessions()
            } catch (cause) {
                onError(toErrorText(cause))
            }
        },
        [onError, onNotice, projectDir, refreshSessions, session, setContexts],
    )

    return {
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
    }
}
