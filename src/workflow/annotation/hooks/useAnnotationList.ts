/**
 * 标注列表数据：分页、筛选、关键词防抖与删除后局部更新。
 * 复用约定：协议走 bridge，类型取 @shared/types/editor；跳转直接调宿主的 annotation/reveal。
 * 关键约束：关键词 300ms 防抖并重置游标；删除后只从当前页移除并重算总数，
 * 不做整页刷新——用户翻到第 3 页删除一条，刷新会把他弹回顶部。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
    AnnotationCursor,
    AnnotationDocumentSummary,
    AnnotationListResult,
    AnnotationRecord,
    HighlightColor,
} from '@shared/types/editor'
import { request } from '@shared/utils/bridge'

/** 每页条数：与查询层默认值一致 */
const PAGE_SIZE = 50

/** 搜索防抖：输入过程中不打请求 */
const SEARCH_DEBOUNCE_MS = 300

export interface AnnotationFilters {
    kind: 'highlight' | 'note' | null
    /** 划线颜色：null 表示不限 */
    color: HighlightColor | null
    /** 文档相对路径：null 表示全部文档 */
    docPath: string | null
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
    /** 有标注的文档清单：文档维度筛选的数据源 */
    documents: AnnotationDocumentSummary[]
    /** 首页总量：翻页后不再变化 */
    total: number | null
    isLoading: boolean
    error: string | null
    hasMore: boolean
    filters: AnnotationFilters
    setFilters: (next: AnnotationFilters) => void
    loadMore: () => Promise<void>
    /** 改划线颜色：只更新该条，不重load 列表 */
    updateColor: (id: string, color: HighlightColor) => Promise<void>
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
        docPath: null,
        orphanedOnly: false,
        keyword: '',
    })
    /** 有标注的文档清单：供文档维度筛选，随删除刷新（某文档可能归零后消失） */
    const [documents, setDocuments] = useState<AnnotationDocumentSummary[]>([])
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
                docPath: current.docPath,
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

    /** 文档清单：随删除刷新，某文档条目归零后应从下拉里消失 */
    const loadDocuments = useCallback(async (): Promise<void> => {
        try {
            const result = await request<{ items: AnnotationDocumentSummary[] }>('annotation/documents', {})
            setDocuments(result.items)
        } catch {
            // 清单失败不影响列表本身，下拉退化为「全部文档」
            setDocuments([])
        }
    }, [])

    const remove = useCallback(
        async (id: string): Promise<void> => {
            try {
                await request('annotation/remove', { id })
                setItems((previous) => previous.filter((item) => item.id !== id))
                setTotal((previous) => (previous === null ? previous : Math.max(previous - 1, 0)))
                await loadDocuments()
            } catch {
                setError('删除失败，请稍后重试')
            }
        },
        [loadDocuments],
    )

    const updateColor = useCallback(async (id: string, color: HighlightColor): Promise<void> => {
        try {
            await request('annotation/update', { id, color })
            // 局部更新：不重拉列表，用户翻到第 3 页改个颜色不该被弹回顶部
            setItems((previous) => previous.map((item) => (item.id === id ? { ...item, color } : item)))
        } catch {
            setError('改色失败，请稍后重试')
        }
    }, [])

    const reveal = useCallback(async (id: string): Promise<RevealOutcome> => {
        return request<RevealOutcome>('annotation/reveal', { id })
    }, [])

    // 首次挂载拉一次文档清单：筛选下拉需要它，与列表请求并行
    useEffect(() => {
        void loadDocuments()
    }, [loadDocuments])

    return {
        items,
        total,
        documents,
        isLoading,
        error,
        hasMore: cursorRef.current !== null,
        filters,
        setFilters,
        loadMore,
        updateColor,
        remove,
        reveal,
    }
}
