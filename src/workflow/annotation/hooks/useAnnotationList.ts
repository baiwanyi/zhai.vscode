/**
 * 标注列表数据：分页、筛选、关键词防抖与删除后局部更新。
 * 复用约定：协议走 bridge，类型取 @shared/types/editor；跳转直接调宿主的 annotation/reveal。
 * 关键约束：只有关键词吃 300ms 防抖，点选类筛选与首屏立即下发；删除后只从当前页移除，
 * 不做整页刷新——用户翻到第 3 页删除一条，刷新会把他弹回顶部；
 * 续载有闸门、首页请求不受限，并发靠请求序号只认最后一次，避免旧响应盖掉新筛选结果；
 * 跳转发现原文缺失时宿主会把整篇置失效，这里按 docPath 同步标记已有的条目，避免还要手动刷新；
 * isEnabled 为假时（如「查询」页签）不下发请求，回切时依赖变化会重新拉首页。
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

/**
 * @param initialKind 首屏筛选类型：与页签默认值同源，仅首次挂载生效
 * @param isEnabled 视图是否在展示列表：为假时挂起请求，回切时重新拉首页
 */
export function useAnnotationList(
    initialKind: AnnotationFilters['kind'] = null,
    isEnabled = true,
): UseAnnotationListResult {
    const [items, setItems] = useState<AnnotationRecord[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [filters, setFilters] = useState<AnnotationFilters>({
        kind: initialKind,
        color: null,
        docPath: null,
        orphanedOnly: false,
        keyword: '',
    })
    /** 下一页游标：null 表示已到末页；作为渲染输入（hasMore），必须放 state 而非 ref */
    const [cursor, setCursor] = useState<AnnotationCursor | null>(null)
    const filtersRef = useRef(filters)
    const isLoadingRef = useRef(false)
    /** 请求序号：并发时只认最后一次，旧响应回来即作废 */
    const requestSeqRef = useRef(0)
    /** 上一次的关键词：只有它变化才需要等用户停手，其余筛选是点选，立即生效 */
    const prevKeywordRef = useRef(filters.keyword)

    const fetchPage = useCallback(async (cursor: AnnotationCursor | null, append: boolean): Promise<void> => {
        // 续载保留闸门：哨兵会连续触发，同一游标不重复请求；
        // 首页请求不受闸门限制，否则会被在飞的续载吞掉，表现为「筛选没反应」
        if (append && isLoadingRef.current) {
            return
        }
        requestSeqRef.current += 1
        const seq = requestSeqRef.current
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
            // 过期响应：期间已有更新的请求（筛选变更），本次结果作废
            if (seq !== requestSeqRef.current) {
                return
            }
            setCursor(result.nextCursor)
            setItems((previous) => (append ? [...previous, ...result.items] : result.items))
            setError(null)
        } catch {
            if (seq === requestSeqRef.current) {
                setError('加载失败，请稍后重试')
            }
        } finally {
            // 只在最新请求结束时释放闸门与加载态，旧请求不得干扰新请求
            if (seq === requestSeqRef.current) {
                isLoadingRef.current = false
                setIsLoading(false)
            }
        }
    }, [])

    // 筛选或关键词变化即回到首页：只有关键词需要等用户停手，点选类条件立即生效
    useEffect(() => {
        filtersRef.current = filters
        // 视图没在展示列表（如「查询」页签）时就别下发：切回时依赖变化会补拉首页
        if (!isEnabled) {
            return undefined
        }
        const isKeywordChanged = prevKeywordRef.current !== filters.keyword
        prevKeywordRef.current = filters.keyword
        const timer = setTimeout(
            (): void => {
                setCursor(null)
                void fetchPage(null, false)
            },
            isKeywordChanged ? SEARCH_DEBOUNCE_MS : 0,
        )
        return (): void => {
            clearTimeout(timer)
        }
    }, [fetchPage, filters, isEnabled])

    const loadMore = useCallback(async (): Promise<void> => {
        if (cursor === null) {
            return
        }
        await fetchPage(cursor, true)
    }, [cursor, fetchPage])

    const remove = useCallback(async (id: string): Promise<void> => {
        try {
            await request('annotation/remove', { id })
            setItems((previous) => previous.filter((item) => item.id !== id))
        } catch {
            setError('删除失败，请稍后重试')
        }
    }, [])

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
        const outcome = await request<RevealOutcome>('annotation/reveal', { id })
        if (!outcome.revealed && outcome.reason === 'missing-file') {
            // 宿主已把该文档整篇置失效：本地同步标记，列表不必重新拉取就能看到失效状态
            setItems((previous) => {
                const target = previous.find((item) => item.id === id)
                if (target === undefined) {
                    return previous
                }
                return previous.map((item) => (item.docPath === target.docPath ? { ...item, orphaned: true } : item))
            })
        }
        return outcome
    }, [])

    return {
        items,
        isLoading,
        error,
        hasMore: cursor !== null,
        filters,
        setFilters,
        loadMore,
        updateColor,
        remove,
        reveal,
    }
}
