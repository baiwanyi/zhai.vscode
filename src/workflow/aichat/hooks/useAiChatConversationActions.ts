/**
 * AI 对话的会话动作编排：新建 / 切换 / 删除三条路径的统一入口。
 * 复用约定：会话操作由 useAiChatSession 注入，命令清空由 useAiChatDraft 注入，本层只编排调用顺序、不持有状态。
 * 关键约束：切换成功时必须「先清本地命令、再套用快照」—— 反了会被本地选择挡住目标会话草稿里的命令；
 * 命令只在操作成功后清空，失败时保留用户已选；删除会话不回读写回目标（目标由编辑器决定，与会话无关）。
 */
import { useCallback, useMemo } from 'react'
import type { AiSessionSnapshot } from '@shared/types/aiChat'

/** 会话动作 hook 的对外依赖：会话操作与草稿操作均由页面注入 */
export interface UseAiChatConversationActionsOptions {
    /** 新建会话：返回是否成功，失败时保留输入与已选命令 */
    startNewSession: () => Promise<boolean>
    /** 切换会话：未切换、失败或被更新的选择取代时为 null */
    switchSession: (conversationId: string) => Promise<AiSessionSnapshot | null>
    deleteSession: (conversationId: string) => Promise<void>
    clearCommand: () => void
    /** 快照回填：只取草稿里的命令，正文由会话 hook 恢复 */
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
    clearCommand,
    applySnapshot,
    refreshWriteState,
}: UseAiChatConversationActionsOptions): AiChatConversationActions {
    const create = useCallback((): void => {
        // 命令在新建成功后才清：请求失败时保留用户已选，不必重选
        void startNewSession().then((isCreated) => {
            if (!isCreated) {
                return
            }
            clearCommand()
            void refreshWriteState()
        })
    }, [clearCommand, refreshWriteState, startNewSession])

    const select = useCallback(
        (conversationId: string): void => {
            void switchSession(conversationId).then((snapshot) => {
                if (snapshot === null) {
                    return
                }
                // 先清本地命令再套用快照：否则本地选择会挡掉该会话草稿里的命令
                clearCommand()
                applySnapshot(snapshot)
                void refreshWriteState()
            })
        },
        [applySnapshot, clearCommand, refreshWriteState, switchSession],
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
