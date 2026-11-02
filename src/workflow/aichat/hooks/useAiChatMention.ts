/**
 * 提及检索：按关键词查索引候选，或按粘贴的 `@zhai\` 路径直接添加为上下文引用。
 * 复用约定：检索骨架取 ./useAiChatSearchResults（空关键词短路、过期回包丢弃、关闭清空），
 * 请求走 @shared/utils/bridge，错误经注入的 onError 统一提示，添加成功后由调用方刷新上下文清单。
 * 关键约束：行范围由宿主重新校验并读取，前端只透传粘贴得到的数字；
 * 候选只透传宿主生成的 path 与展示字段，不在前端解析文件内容。
 */
import { useCallback } from 'react'
import type { AiMentionCandidate } from '@shared/types/aiChat'
import { request } from '@shared/utils/bridge'
import { toErrorText } from '@shared/utils/error'
import { useAiChatSearch } from './useAiChatSearchResults'

/** 粘贴引用目标：存储根相对路径与可选行范围 */
export interface AiPastedRefTarget {
    relative: string
    startLine: number | null
    endLine: number | null
}

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
    /** 按粘贴的 @zhai 路径添加引用：行范围可选，成功返回 true */
    addPath: (target: AiPastedRefTarget) => Promise<boolean>
    /** 关闭时清空候选，避免下次打开看到上一次的结果 */
    reset: () => void
}

export function useAiChatMention({ onError, onAdded }: UseAiChatMentionOptions): AiChatMentionState {
    const load = useCallback(async (keyword: string): Promise<readonly AiMentionCandidate[]> => {
        const result = await request<{ candidates: AiMentionCandidate[] }>('ai/mention/search', { keyword })
        return result.candidates
    }, [])

    const { items: candidates, isSearching, search, reset } = useAiChatSearch({ onError, load })

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

    const addPath = useCallback(
        async (target: AiPastedRefTarget): Promise<boolean> => {
            try {
                await request('ai/mention/add', {
                    path: target.relative,
                    startLine: target.startLine,
                    endLine: target.endLine,
                })
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

    return { candidates, isSearching, search, add, addPath, reset }
}
