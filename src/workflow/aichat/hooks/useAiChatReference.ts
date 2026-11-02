/**
 * 参考资料检索：按关键词查 {存储根}/reference 语料，选中后按行范围注入本轮上下文。
 * 复用约定：检索骨架取 ./useAiChatSearchResults（空关键词短路、过期回包丢弃、关闭清空），
 * 请求走 @shared/utils/bridge，错误经注入的 onError 提示，添加成功后由调用方刷新上下文清单。
 * 关键约束：打开目录失败只提示，不影响面板其余操作；语料目录缺失时由宿主创建，前端不推断路径。
 */
import { useCallback } from 'react'
import type { AiReferenceEntry } from '@shared/types/aiChat'
import { request } from '@shared/utils/bridge'
import { toErrorText } from '@shared/utils/error'
import { useAiChatSearch } from './useAiChatSearchResults'

export interface UseAiChatReferenceOptions {
    onError: (error: string | null) => void
    /** 添加成功后的回调：由调用方重拉上下文清单 */
    onAdded: () => void
}

export interface AiChatReferenceState {
    entries: readonly AiReferenceEntry[]
    isSearching: boolean
    search: (keyword: string) => Promise<void>
    add: (entry: AiReferenceEntry) => Promise<boolean>
    /** 打开语料目录：目录不存在时由宿主创建 */
    openDir: () => Promise<void>
    reset: () => void
}

export function useAiChatReference({ onError, onAdded }: UseAiChatReferenceOptions): AiChatReferenceState {
    const load = useCallback(async (keyword: string): Promise<readonly AiReferenceEntry[]> => {
        const result = await request<{ entries: AiReferenceEntry[] }>('ai/reference/search', { keyword })
        return result.entries
    }, [])

    const { items: entries, isSearching, search, reset } = useAiChatSearch({ onError, load })

    const add = useCallback(
        async (entry: AiReferenceEntry): Promise<boolean> => {
            try {
                await request('ai/reference/add', { file: entry.file, startLine: entry.startLine })
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

    const openDir = useCallback(async (): Promise<void> => {
        try {
            await request('ai/reference/openDir')
        } catch (cause) {
            onError(toErrorText(cause))
        }
    }, [onError])

    return { entries, isSearching, search, add, openDir, reset }
}
