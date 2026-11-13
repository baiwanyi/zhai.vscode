/**
 * AI 解释记录：标注总览页的跨文档列举、关键词搜索、删除与跳转。
 * 复用约定：协议走 bridge 的 annotation/queries 系列，类型取 @shared/types/editor；
 * 关键词 300ms 防抖，与标注列表同一节奏，输入过程中不打请求。
 * 关键约束：删除只在成功后从当前列表移除，不做整页刷新（与标注列表同一处理）；
 * 首批固定 50 条、不做翻页——查询记录是附加视图，翻页价值低于标注本身；
 * 列表本身按「文本 + 问题」去重，同一段文字只有一条，只在标注页做浏览与删除，不提供跳转。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { EditorQueryListResult, EditorQueryRecord } from '@shared/types/editor'
import { request } from '@shared/utils/bridge'

/** 每批条数：与宿主 annotationRoutes 的默认值一致 */
const PAGE_LIMIT = 50

/** 搜索防抖：输入过程中不打请求 */
const SEARCH_DEBOUNCE_MS = 300

export interface UseQueryRecordsResult {
    items: EditorQueryRecord[]
    /** 符合当前关键词的总条数：标题上的计数 */
    total: number
    isLoading: boolean
    error: string | null
    keyword: string
    setKeyword: (value: string) => void
    /** 手动刷新：在编辑器里查完再切回标注页时用 */
    reload: () => Promise<void>
    remove: (id: string) => Promise<void>
}

export function useQueryRecords(): UseQueryRecordsResult {
    const [items, setItems] = useState<EditorQueryRecord[]>([])
    const [total, setTotal] = useState(0)
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [keyword, setKeyword] = useState('')
    /** 刷新用：防抖回调与手动刷新取同一份最新关键词 */
    const keywordRef = useRef('')

    const fetchList = useCallback(async (nextKeyword: string): Promise<void> => {
        setIsLoading(true)
        try {
            const result = await request<EditorQueryListResult>('annotation/queries', {
                keyword: nextKeyword,
                limit: PAGE_LIMIT,
            })
            setItems(result.items)
            setTotal(result.total)
            setError(null)
        } catch {
            setError('加载 AI 解释记录失败，请稍后重试')
        } finally {
            setIsLoading(false)
        }
    }, [])

    // 关键词变化即重拉：防抖期间用户还在输入，不必每敲一个字都打库
    useEffect(() => {
        keywordRef.current = keyword
        const timer = setTimeout((): void => {
            void fetchList(keyword)
        }, SEARCH_DEBOUNCE_MS)
        return (): void => {
            clearTimeout(timer)
        }
    }, [fetchList, keyword])

    const reload = useCallback(async (): Promise<void> => {
        await fetchList(keywordRef.current)
    }, [fetchList])

    const remove = useCallback(async (id: string): Promise<void> => {
        try {
            await request('annotation/query/remove', { id })
            // 局部更新：不重拉列表，用户滚到中间删一条不该被弹回顶部
            setItems((previous) => previous.filter((item) => item.id !== id))
            setTotal((previous) => Math.max(previous - 1, 0))
        } catch {
            setError('删除失败，请稍后重试')
        }
    }, [])

    return { items, total, isLoading, error, keyword, setKeyword, reload, remove }
}
