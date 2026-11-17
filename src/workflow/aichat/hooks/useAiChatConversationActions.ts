/**
 * AI 对话的会话动作编排：新建 / 切换 / 删除三条路径的统一入口。
 * 复用约定：会话操作由 useAiChatSession 注入，规则回填由 useAiChatDraft 注入，本层只编排调用顺序、不持有状态。
 * 关键约束：切换成功后必须套用目标会话的快照回填规则；失败时保留当前输入与已挂规则；
 * 删除会话不回读写回目标（目标由编辑器决定，与会话无关）。
 */
import { useCallback, useMemo } from 'react'
import type { AiSessionSnapshot } from '@shared/types/aiChat'

/** 会话动作 hook 的对外依赖：会话操作与草稿操作均由页面注入 */
export interface UseAiChatConversationActionsOptions {
    /** 新建会话：返回是否成功，失败时保留输入与已挂规则 */
    startNewSession: () => Promise<boolean>
    /** 切换会话：未切换、失败或被更新的选择取代时为 null */
    switchSession: (conversationId: string) => Promise<AiSessionSnapshot | null>
    deleteSession: (conversationId: string) => Promise<void>
    /** 快照回填：只取草稿里的规则，正文由会话 hook 恢复 */
    applySnapshot: (snapshot: AiSessionSnapshot) => void
    /** 会话切换后重读写回目标：新建 / 切换可能换掉当前文档的可写范围 */
    refreshWriteState: () => Promise<void>
}

/** 会话动作对外暴露的操作 */
export interface AiChatConversationActions {
    create: () => void
    select: (conversationId: string) => void
    remove: (conversationId: string) => void
}

export function useAiChatConversationActions({
    startNewSession,
    switchSession,
    deleteSession,
    applySnapshot,
    refreshWriteState,
}: UseAiChatConversationActionsOptions): AiChatConversationActions {
    const create = useCallback((): void => {
        void startNewSession().then((isCreated) => {
            if (!isCreated) {
                return
            }
            void refreshWriteState()
        })
    }, [refreshWriteState, startNewSession])

    const select = useCallback(
        (conversationId: string): void => {
            void switchSession(conversationId).then((snapshot) => {
                if (snapshot === null) {
                    return
                }
                applySnapshot(snapshot)
                void refreshWriteState()
            })
        },
        [applySnapshot, refreshWriteState, switchSession],
    )

    /** 删除：列表刷新由会话 hook 内部完成，这里只负责触发 */
    const remove = useCallback(
        (conversationId: string): void => {
            void deleteSession(conversationId)
        },
        [deleteSession],
    )

    return useMemo(() => ({ create, select, remove }), [create, remove, select])
}
