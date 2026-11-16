/**
 * 跨笔记本笔记搜索：按关键词去抖请求宿主，命中结果扁平返回，供页面在搜索态替换分组列表。
 * 复用 @shared/utils/bridge 走 note/search 协议、@shared/utils/error 归一错误文案。
 * 关键约束：去抖期间保留上一次结果，避免每敲一个字列表就闪空；
 * 关键词清空立即复位为空结果、不再发请求，并使在途响应失效；响应按请求序号丢弃过期结果，
 * 防止旧请求覆盖新关键词或清空后把旧命中写回。
 */
import { useEffect, useRef, useState } from 'react'
import type { RecentFile } from '@shared/types/dashboard'
import type { SearchNotesResult } from '@shared/types/note'
import { request } from '@shared/utils/bridge'
import { toErrorText } from '@shared/utils/error'

/** 输入去抖时长：够快又不会每敲一个字就发一次请求 */
const SEARCH_DEBOUNCE_MS = 250

/** 结果条数上限：与宿主侧收窄口径保持一致 */
const SEARCH_LIMIT = 100

export interface NoteSearchState {
    results: RecentFile[]
    /** 当前关键词是否正在请求（含去抖窗口） */
    isSearching: boolean
    error: string | null
}

export function useNoteSearch(query: string): NoteSearchState {
    const keyword = query.trim()
    const [results, setResults] = useState<RecentFile[]>([])
    const [isSearching, setIsSearching] = useState(false)
    const [error, setError] = useState<string | null>(null)
    /** 请求序号：只有最后一次请求的结果会落到状态里 */
    const requestSeqRef = useRef(0)

    useEffect(() => {
        if (keyword === '') {
            // 自增序号使在途响应失效：清空后迟到的结果不得把旧命中写回
            requestSeqRef.current += 1
            setResults([])
            setIsSearching(false)
            setError(null)
            return
        }
        setIsSearching(true)
        const seq = requestSeqRef.current + 1
        requestSeqRef.current = seq
        const timer = setTimeout(() => {
            void request<SearchNotesResult>('note/search', { query: keyword, limit: SEARCH_LIMIT })
                .then((result) => {
                    if (requestSeqRef.current !== seq) {
                        return
                    }
                    setResults(result.items)
                    setError(null)
                })
                .catch((cause: unknown) => {
                    if (requestSeqRef.current !== seq) {
                        return
                    }
                    setResults([])
                    setError(toErrorText(cause))
                })
                .finally(() => {
                    if (requestSeqRef.current === seq) {
                        setIsSearching(false)
                    }
                })
        }, SEARCH_DEBOUNCE_MS)
        return (): void => {
            clearTimeout(timer)
        }
    }, [keyword])

    return { results, isSearching, error }
}
