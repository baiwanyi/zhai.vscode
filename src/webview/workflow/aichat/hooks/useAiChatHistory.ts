/**
 * AI 对话历史会话列表：经宿主 ai/sessions 协议拉取最近会话摘要，供「历史对话」浮层展示。
 * 列表仅在浮层打开 / 删除会话后按需刷新，避免展示过期数据；切换会话的写入动作由会话 hook 承担。
 */
import { useCallback, useState } from 'react'
import type { AiConversationSummary } from '@shared/types/aiChat'
import { request } from '../../../bridge'
import { toErrorText } from '../utils'

/** 历史列表 hook 的对外依赖：错误由共享提示 hook 持有 */
export interface UseAiChatHistoryOptions {
    onError: (error: string | null) => void
}

/** 历史会话列表对外暴露的状态与操作 */
export interface AiChatHistoryState {
    sessions: AiConversationSummary[]
    loadSessions: () => Promise<void>
}

export function useAiChatHistory({ onError }: UseAiChatHistoryOptions): AiChatHistoryState {
    const [sessions, setSessions] = useState<AiConversationSummary[]>([])

    const loadSessions = useCallback(async (): Promise<void> => {
        try {
            setSessions(await request<AiConversationSummary[]>('ai/sessions'))
        } catch (cause) {
            onError(toErrorText(cause))
        }
    }, [onError])

    return { sessions, loadSessions }
}
