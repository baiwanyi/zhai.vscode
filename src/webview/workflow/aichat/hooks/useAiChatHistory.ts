/**
 * AI 对话历史会话列表：经宿主 ai/sessions 协议拉取最近会话摘要，供「历史对话」浮层展示。
 * 列表仅在浮层打开 / 删除会话后按需刷新，避免展示过期数据；切换会话的写入动作由会话 hook 承担。
 * 关键约束：列表按作用域（作品目录）过滤，只列出当前作品的对话，切作品即换一份历史。
 */
import { useCallback, useState } from 'react'
import type { AiConversationSummary } from '@shared/types/aiChat'
import { request } from '../../../bridge'
import { toErrorText } from '../utils'

/** 历史列表 hook 的对外依赖：错误由共享提示 hook 持有 */
export interface UseAiChatHistoryOptions {
    onError: (error: string | null) => void
    /** 会话作用域（作品目录）：只列出该作品下的历史对话，null 表示不属于任何作品的通用对话 */
    projectDir: string | null
}

/** 历史会话列表对外暴露的状态与操作 */
export interface AiChatHistoryState {
    sessions: AiConversationSummary[]
    loadSessions: () => Promise<void>
}

export function useAiChatHistory({ onError, projectDir }: UseAiChatHistoryOptions): AiChatHistoryState {
    const [sessions, setSessions] = useState<AiConversationSummary[]>([])

    const loadSessions = useCallback(async (): Promise<void> => {
        try {
            setSessions(await request<AiConversationSummary[]>('ai/sessions', { projectDir }))
        } catch (cause) {
            onError(toErrorText(cause))
        }
    }, [onError, projectDir])

    return { sessions, loadSessions }
}
