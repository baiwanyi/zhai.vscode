/**
 * AI 对话检索面板的公共骨架：关键词检索、过期回包丢弃、关闭清空，供提及检索与参考资料共用。
 * 复用约定：检索请求由调用方以 load 注入并负责结果字段收窄，错误经 onError 上报；空关键词直接清空、不发请求。
 * 关键约束：只有最后一次请求的回包允许写入状态，慢请求覆盖后一次输入会让候选错位；
 * reset 自增序号，关闭面板后仍在途的回包不得再写回；loading 只在最新序号上复位。
 */
import { useCallback, useRef, useState } from 'react'
import { toErrorText } from '@shared/utils/error'

/** 检索骨架的对外依赖：load 需为稳定引用，否则 search 会随每次渲染重建 */
export interface UseAiChatSearchOptions<T> {
    onError: (error: string | null) => void
    load: (keyword: string) => Promise<readonly T[]>
}

/** 检索骨架对外暴露的状态与操作 */
export interface AiChatSearchState<T> {
    items: readonly T[]
    isSearching: boolean
    search: (keyword: string) => Promise<void>
    /** 关闭时清空结果，避免下次打开看到上一次的内容 */
    reset: () => void
}

export function useAiChatSearch<T>({ onError, load }: UseAiChatSearchOptions<T>): AiChatSearchState<T> {
    const [items, setItems] = useState<readonly T[]>([])
    const [isSearching, setIsSearching] = useState(false)
    /** 检索序号：只有最后一次请求的回包才允许写入状态 */
    const searchIdRef = useRef(0)

    const search = useCallback(
        async (keyword: string): Promise<void> => {
            if (keyword.trim().length === 0) {
                searchIdRef.current += 1
                setItems([])
                return
            }
            const requestId = searchIdRef.current + 1
            searchIdRef.current = requestId
            setIsSearching(true)
            try {
                const result = await load(keyword)
                if (searchIdRef.current === requestId) {
                    setItems(result)
                }
            } catch (cause) {
                if (searchIdRef.current === requestId) {
                    setItems([])
                }
                onError(toErrorText(cause))
            } finally {
                if (searchIdRef.current === requestId) {
                    setIsSearching(false)
                }
            }
        },
        [load, onError],
    )

    const reset = useCallback((): void => {
        searchIdRef.current += 1
        setItems([])
        setIsSearching(false)
    }, [])

    return { items, isSearching, search, reset }
}
