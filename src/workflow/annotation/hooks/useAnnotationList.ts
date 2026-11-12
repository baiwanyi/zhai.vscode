/**
 * 标注列表数据：分页、筛选、关键词防抖与删除后局部更新。
 * 复用约定：协议走 bridge，类型取 @shared/types/editor；跳转直接调宿主的 annotation/reveal。
 * 关键约束：关键词 300ms 防抖并重置游标；删除后只从当前页移除并重算总数，
 * 不做整页刷新——用户翻到第 3 页删除一条，刷新会把他弹回顶部。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AnnotationCursor, AnnotationListResult, AnnotationRecord, HighlightColor } from '@shared/types/editor'
import { request } from '@shared/utils/bridge'

/** 每页条数：与查询层默认值一致 */
const PAGE_SIZE = 50

/** 搜索防抖：输入过程中不打请求 */
const SEARCH_DEBOUNCE_MS = 300

export interface AnnotationFilters {
    kind: 'highlight' | 'note' | null
    /** 划线颜色：null 表示不限 */
    color: HighlightColor | null
    orphanedOnly: boolean
    keyword: string
}

export interface RevealOutcome {
    revealed: boolean
    reason?: string
    orphaned?: boolean
}

export interface UseAnnotationListResult {
    items: AnnotationRecord[]
    /** 首页总量：翻页后不再变化 */
    total: number | null
    isLoading: boolean
    error: string | null
    hasMore: boolean
    filters: AnnotationFilters
    setFilters: (next: AnnotationFilters) => void
    loadMore: () => Promise<void>
    remove: (id: string) => Promise<void>
    reveal: (id: string) => Promise<RevealOutcome>
}

export function useAnnotationList(): UseAnnotationListResult {
    const [items, setItems] = useState<AnnotationRecord[]>([])
    const [total, setTotal] = useState<number | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [filters, setFilters] = useState<AnnotationFilters>({
        kind: null,
        color: null,
        orphanedOnly: false,
        keyword: '',
    })
    const cursorRef = useRef<AnnotationCursor | null>(null)
    const filtersRef = useRef(filters)
    const isLoadingRef = useRef(false)

    const fetchPage = useCallback(async (cursor: AnnotationCursor | null, append: boolean): Promise<void> => {
        if (isLoadingRef.current) {
            return
        }
        isLoadingRef.current = true
        setIsLoading(true)
        try {
            const current = filtersRef.current
            const result = await request<AnnotationListResult>('annotation/list', {
                cursor,
                limit: PAGE_SIZE,
                kind: current.kind,
                color: current.color,
                docPath: null,
                orphanedOnly: current.orphanedOnly,
                keyword: current.keyword,
            })
            cursorRef.current = result.nextCursor
            setItems((previous) => (append ? [...previous, ...result.items] : result.items))
            if (result.total !== null) {
                setTotal(result.total)
            }
            setError(null)
        } catch {
            setError('加载失败，请稍后重试')
        } finally {
            isLoadingRef.current = false
            setIsLoading(false)
        }
    }, [])

    // 筛选或关键词变化即回到首页：防抖期间用户还在输入，不打请求
    useEffect(() => {
        filtersRef.current = filters
        const timer = setTimeout((): void => {
            cursorRef.current = null
            void fetchPage(null, false)
        }, SEARCH_DEBOUNCE_MS)
        return (): void => {
            clearTimeout(timer)
        }
    }, [fetchPage, filters])

    const loadMore = useCallback(async (): Promise<void> => {
        if (cursorRef.current === null) {
            return
        }
        await fetchPage(cursorRef.current, true)
    }, [fetchPage])

    const remove = useCallback(async (id: string): Promise<void> => {
        try {
            await request('annotation/remove', { id })
            setItems((previous) => previous.filter((item) => item.id !== id))
            setTotal((previous) => (previous === null ? previous : Math.max(previous - 1, 0)))
        } catch {
            setError('删除失败，请稍后重试')
        }
    }, [])

    const reveal = useCallback(async (id: string): Promise<RevealOutcome> => {
        return request<RevealOutcome>('annotation/reveal', { id })
    }, [])

    return {
        items,
        total,
        isLoading,
        error,
        hasMore: cursorRef.current !== null,
        filters,
        setFilters,
        loadMore,
        remove,
        reveal,
    }
}
