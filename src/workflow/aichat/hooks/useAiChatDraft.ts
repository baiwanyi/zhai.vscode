/**
 * AI 对话草稿：持有当前写作命令与未发送正文，负责防抖写入宿主草稿、按会话快照回填命令、按历史消息回填输入框。
 * 复用约定：命令表取 ../constants，快照与消息类型取 @shared/types/aiChat，持久化走 @shared/utils/bridge 的 ai/draft 协议，
 * 消息回显拆分复用 ../utils。
 * 关键约束：commandId 的 ref 与 state 必须同一个出口同步写——快照回填先判 ref 再判 state，
 * 否则一次渲染延迟会让用户之后主动取消的命令被重新恢复；同一会话的草稿只套用一次；
 * 重复消息只回填命令与正文，引用不恢复（历史引用可能已失效）；body 为空串也要回填，用于清掉旧输入。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AiMessage, AiSessionSnapshot } from '@shared/types/aiChat'
import { request } from '@shared/utils/bridge'
import type { AiCommand, AiCommandId } from '../constants'
import { AI_COMMAND_MAP, isAiCommandId } from '../constants'
import { splitCommandContent } from '../utils'

/** 草稿落宿主的防抖时长：连续输入只在停顿后写一次 */
const DRAFT_DEBOUNCE_MS = 300

/** 草稿 hook 的对外依赖：会话 id 决定草稿归属，正文与写入函数由会话 hook 持有 */
export interface UseAiChatDraftOptions {
    /** 当前会话 id：草稿按会话保存，null 表示会话尚未就绪，不写入 */
    conversationId: string | null
    /** 当前输入正文：仅用于防抖持久化，不由此 hook 持有 */
    input: string
    setInput: (input: string) => void
}

/** 草稿对外暴露的状态与操作 */
export interface AiChatDraftState {
    commandId: AiCommandId | null
    /** 当前命令定义：null 表示未选，输入区只展示 title 徽章 */
    command: AiCommand | null
    /** 命令点击：只记录选择（再次点击同一命令即取消） */
    selectCommand: (command: AiCommand) => void
    clearCommand: () => void
    /** 会话快照回填：只取草稿里的命令，正文由会话 hook 自行恢复 */
    applySnapshot: (snapshot: AiSessionSnapshot) => void
    /** 历史消息回填：命令与补充文本进输入区，引用不回填 */
    restoreFromMessage: (message: AiMessage) => void
}

export function useAiChatDraft({ conversationId, input, setInput }: UseAiChatDraftOptions): AiChatDraftState {
    const [commandId, setCommandId] = useState<AiCommandId | null>(null)
    /** 已套用草稿的会话 id：避免重复套用把用户之后主动取消的命令重新恢复 */
    const restoredDraftRef = useRef<string | null>(null)
    /** 命令选择的最新值：草稿套用时判断本地是否已有选择，作为唯一可信来源 */
    const commandIdRef = useRef<AiCommandId | null>(null)

    /** 命令变更的唯一出口：ref 与 state 同步写，避免快照套用读到上一帧的值 */
    const commitCommand = useCallback((next: AiCommandId | null): void => {
        commandIdRef.current = next
        setCommandId(next)
    }, [])

    const selectCommand = useCallback(
        (next: AiCommand): void => {
            commitCommand(commandIdRef.current === next.id ? null : next.id)
        },
        [commitCommand],
    )

    const clearCommand = useCallback((): void => {
        commitCommand(null)
    }, [commitCommand])

    /** 套用草稿中的命令：同一会话只处理一次，本地已选命令时保留本地选择 */
    const applySnapshot = useCallback(
        (snapshot: AiSessionSnapshot): void => {
            const id = snapshot.conversation.id
            if (restoredDraftRef.current === id) {
                return
            }
            restoredDraftRef.current = id
            if (commandIdRef.current !== null || !isAiCommandId(snapshot.draft.commandId)) {
                return
            }
            commitCommand(snapshot.draft.commandId)
        },
        [commitCommand],
    )

    const restoreFromMessage = useCallback(
        (message: AiMessage): void => {
            const { command: picked, body } = splitCommandContent(message.content)
            commitCommand(picked?.id ?? null)
            setInput(body)
        },
        [commitCommand, setInput],
    )

    // 未发送正文与命令防抖写入宿主草稿：侧边栏切换导致 webview 重建后由会话快照带回
    useEffect(() => {
        if (conversationId === null) {
            return
        }
        const timer = setTimeout(() => {
            void request('ai/draft', { conversationId, input, commandId })
        }, DRAFT_DEBOUNCE_MS)
        return (): void => {
            clearTimeout(timer)
        }
    }, [commandId, conversationId, input])

    const command = commandId === null ? null : AI_COMMAND_MAP[commandId]

    return useMemo(
        () => ({ commandId, command, selectCommand, clearCommand, applySnapshot, restoreFromMessage }),
        [applySnapshot, clearCommand, command, commandId, restoreFromMessage, selectCommand],
    )
}
