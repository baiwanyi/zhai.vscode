/**
 * 提及检索：按关键词查索引候选，选中后交给宿主添加为上下文引用。
 * 复用约定：请求走 @shared/utils/bridge，错误经注入的 onError 统一提示；添加成功后由调用方刷新上下文清单。
 * 关键约束：空关键词不发请求；检索按序号丢弃过期回包，避免慢请求覆盖后一次输入的结果。
 */
import { useCallback, useRef, useState } from 'react'
import type { AiMentionCandidate } from '@shared/types/aiChat'
import { request } from '@shared/utils/bridge'
import { toErrorText } from '@shared/utils/error'

/** 提及 hook 的对外依赖 */
export interface UseAiChatMentionOptions {
    onError: (error: string | null) => void
    /** 添加成功后的回调：由调用方重拉上下文清单 */
    onAdded: () => void
}

export interface AiChatMentionState {
    candidates: readonly AiMentionCandidate[]
    isSearching: boolean
    /** 检索关键词；空串直接清空候选，不发请求 */
    search: (keyword: string) => Promise<void>
    /** 添加候选为引用：成功返回 true */
    add: (candidate: AiMentionCandidate) => Promise<boolean>
    /** 关闭时清空候选，避免下次打开看到上一次的结果 */
    reset: () => void
}

export function useAiChatMention({ onError, onAdded }: UseAiChatMentionOptions): AiChatMentionState {
    const [candidates, setCandidates] = useState<readonly AiMentionCandidate[]>([])
    const [isSearching, setIsSearching] = useState(false)
    /** 检索序号：只有最后一次请求的回包才允许写入状态 */
    const searchIdRef = useRef(0)

    const search = useCallback(
        async (keyword: string): Promise<void> => {
            if (keyword.trim().length === 0) {
                searchIdRef.current += 1
                setCandidates([])
                return
            }
            const requestId = searchIdRef.current + 1
            searchIdRef.current = requestId
            setIsSearching(true)
            try {
                const result = await request<{ candidates: AiMentionCandidate[] }>('ai/mention/search', { keyword })
                if (searchIdRef.current === requestId) {
                    setCandidates(result.candidates)
                }
            } catch (cause) {
                if (searchIdRef.current === requestId) {
                    setCandidates([])
                }
                onError(toErrorText(cause))
            } finally {
                if (searchIdRef.current === requestId) {
                    setIsSearching(false)
                }
            }
        },
        [onError],
    )

    const add = useCallback(
        async (candidate: AiMentionCandidate): Promise<boolean> => {
            try {
                await request('ai/mention/add', { path: candidate.path })
                onError(null)
                onAdded()
                return true
            } catch (cause) {
                onError(toErrorText(cause))
                return false
            }
        },
        [onAdded, onError],
    )

    const reset = useCallback((): void => {
        searchIdRef.current += 1
        setCandidates([])
        setIsSearching(false)
    }, [])

    return { candidates, isSearching, search, add, reset }
}
