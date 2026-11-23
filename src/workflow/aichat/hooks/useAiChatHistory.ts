/**
 * 历史会话数据：按筛选条件拉取列表，并提供筛选切换。
 * 复用约定：列表统一走 ai/sessions；「当前」按作用域取，其余筛选（全部 / 笔记 / 作品 / 公众号 / 微博 /
 * 通用对话）都取全区最近 50 条，由页面在前端切分，避免为每种来源单开查询。
 * 关键约束：全区筛选之间互切不重复请求（只重新切分本地列表），只有跨越「当前 ↔ 全区」时才拉一次；
 * 对外暴露的 loadSessions 不带参数，保持调用方（会话状态机）的引用稳定。
 */
import { useCallback, useRef, useState } from 'react'
import type { AiConversationSummary } from '@shared/types/aiChat'
import { request } from '@shared/utils/bridge'
import { toErrorText } from '@shared/utils/error'
import type { AiChatHistoryMode } from '../history/utils/historyFilters'

interface UseAiChatHistoryOptions {
    onError: (error: string | null) => void
    /** 会话作用域：'scope' 筛选下只列出该作用域的历史对话，null 表示通用对话 */
    projectDir: string | null
}

/** 历史会话列表对外暴露的状态与操作 */
export interface AiChatHistoryState {
    sessions: AiConversationSummary[]
    mode: AiChatHistoryMode
    setMode: (mode: AiChatHistoryMode) => void
    loadSessions: () => Promise<void>
}

export function useAiChatHistory({ onError, projectDir }: UseAiChatHistoryOptions): AiChatHistoryState {
    const [sessions, setSessions] = useState<AiConversationSummary[]>([])
    const [mode, setModeState] = useState<AiChatHistoryMode>('scope')
    /** 当前列表是否来自「全区」查询：范围内互切时只改筛选、不再请求 */
    const isAllLoadedRef = useRef(false)

    const load = useCallback(
        async (target: AiChatHistoryMode): Promise<void> => {
            try {
                setSessions(
                    await request<AiConversationSummary[]>('ai/sessions', {
                        projectDir,
                        all: target !== 'scope',
                    }),
                )
                // 只有真正拿到列表才算「已按该范围加载」：失败时保持原标记，跨来源切换会自然重试
                isAllLoadedRef.current = target !== 'scope'
            } catch (cause) {
                onError(toErrorText(cause))
            }
        },
        [onError, projectDir],
    )

    const loadSessions = useCallback((): Promise<void> => load(mode), [load, mode])

    const setMode = useCallback(
        (next: AiChatHistoryMode): void => {
            setModeState(next)
            if ((next !== 'scope') !== isAllLoadedRef.current) {
                void load(next)
            }
        },
        [load],
    )

    return { sessions, mode, setMode, loadSessions }
}
