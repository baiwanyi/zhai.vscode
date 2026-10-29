/**
 * 参考资料检索：按关键词查 {存储根}/reference 语料，选中后按行范围注入本轮上下文。
 * 复用约定：请求走 @shared/utils/bridge，错误经注入的 onError 提示；添加成功后由调用方刷新上下文清单。
 * 关键约束：空关键词不发请求；检索按序号丢弃过期回包；打开目录失败只提示，不影响面板其余操作。
 */
import { useCallback, useRef, useState } from 'react'
import type { AiReferenceEntry } from '@shared/types/aiChat'
import { request } from '@shared/utils/bridge'
import { toErrorText } from '@shared/utils/error'

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
    const [entries, setEntries] = useState<readonly AiReferenceEntry[]>([])
    const [isSearching, setIsSearching] = useState(false)
    /** 检索序号：只有最后一次请求的回包允许写入状态 */
    const searchIdRef = useRef(0)

    const search = useCallback(
        async (keyword: string): Promise<void> => {
            if (keyword.trim().length === 0) {
                searchIdRef.current += 1
                setEntries([])
                return
            }
            const requestId = searchIdRef.current + 1
            searchIdRef.current = requestId
            setIsSearching(true)
            try {
                const result = await request<{ entries: AiReferenceEntry[] }>('ai/reference/search', { keyword })
                if (searchIdRef.current === requestId) {
                    setEntries(result.entries)
                }
            } catch (cause) {
                if (searchIdRef.current === requestId) {
                    setEntries([])
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

    const reset = useCallback((): void => {
        searchIdRef.current += 1
        setEntries([])
        setIsSearching(false)
    }, [])

    return { entries, isSearching, search, add, openDir, reset }
}
