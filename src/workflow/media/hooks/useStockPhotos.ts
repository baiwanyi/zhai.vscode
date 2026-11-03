/**
 * 在线图库搜索钩子：关键词防抖、话题切换、分页追加、请求竞态丢弃与两种加载态。
 * 复用约定：搜索走 stock/search（话题 slug 一并带进载荷），缩略图补取走 stock/thumb，
 * 返回结构直接用宿主契约。
 * 关键约束：每次请求自增序号，响应回来时序号不一致即丢弃——否则快速改关键词会让旧结果盖掉新结果；
 * 话题与关键词互斥：切话题清空搜索词，输入搜索词即回到「推荐」（话题端点不接受关键词）；
 * 未配置密钥时 isEnabled 为 false，一个请求都不发；追加时按 photoId 过滤已存在的条目；
 * 浏览流上限 5 页，页面上不再放「加载更多」，滚动到底由面板自动续载；
 * 首屏加载与追加加载分开，骨架只在首屏出现。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type {
    StockOrderBy,
    StockOrientation,
    StockPhoto,
    StockSearchResult,
    StockThumbResult,
} from '@shared/types/stock'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'

/** 关键词防抖：太短会让每敲一个字都打掉一次配额 */
const SEARCH_DEBOUNCE_MS = 400

/** 自动加载的页数上限：深翻页对选图没有收益，只烧配额 */
const MAX_SEARCH_PAGES = 5

interface UseStockPhotosOptions {
    /** 是否允许发请求：密钥未配置时不消耗配额，也不报错 */
    isEnabled: boolean
}

export interface UseStockPhotosResult {
    items: StockPhoto[]
    query: string
    setQuery: (value: string) => void
    orientation: StockOrientation | null
    setOrientation: (value: StockOrientation | null) => void
    /** 浏览流排序：null 表示「默认」（上游各自默认） */
    orderBy: StockOrderBy | null
    setOrderBy: (value: StockOrderBy | null) => void
    /** 当前话题：null 表示「推荐」流 */
    topic: string | null
    setTopic: (value: string | null) => void
    isLoadingFirst: boolean
    isLoadingMore: boolean
    hasMore: boolean
    /** 失败提示：冷却与未配置也走这里，页面据此展示空态 */
    errorText: string | null
    loadMore: () => void
    reload: () => void
    /** 补取单张缩略图：卡片上的「重试」用 */
    retryThumb: (id: string) => void
}

export function useStockPhotos({ isEnabled }: UseStockPhotosOptions): UseStockPhotosResult {
    const [query, setQueryValue] = useState('')
    const [topic, setTopicValue] = useState<string | null>(null)
    const [orientation, setOrientation] = useState<StockOrientation | null>(null)
    const [orderBy, setOrderBy] = useState<StockOrderBy | null>(null)
    const [items, setItems] = useState<StockPhoto[]>([])
    const [isLoadingFirst, setIsLoadingFirst] = useState(true)
    const [isLoadingMore, setIsLoadingMore] = useState(false)
    const [hasMore, setHasMore] = useState(false)
    const [errorText, setErrorText] = useState<string | null>(null)
    /** 已加载到的页码与总页数：用 ref 保存，避免进入 useCallback 依赖导致闭包过期 */
    const pageRef = useRef(0)
    const totalPagesRef = useRef(0)
    /** 请求序号：只有最新一次请求的响应会被采用 */
    const seqRef = useRef(0)

    /** 切话题：清空搜索词，标签与内容保持一致 */
    const setTopic = useCallback((value: string | null): void => {
        setTopicValue(value)
        setQueryValue('')
    }, [])

    /** 输入搜索词：非空即回到「推荐」——话题端点不接受关键词，留着话题只会误导 */
    const setQuery = useCallback((value: string): void => {
        setQueryValue(value)
        if (value.trim().length > 0) {
            setTopicValue(null)
        }
    }, [])

    const runSearch = useCallback(
        async (targetPage: number, mode: 'first' | 'more'): Promise<void> => {
            seqRef.current += 1
            const seq = seqRef.current
            if (mode === 'first') {
                setIsLoadingFirst(true)
            } else {
                setIsLoadingMore(true)
            }
            try {
                const result = await request<StockSearchResult>('stock/search', {
                    query,
                    page: targetPage,
                    orientation,
                    topic,
                    orderBy,
                })
                if (seqRef.current !== seq) {
                    return
                }
                pageRef.current = result.page
                totalPagesRef.current = result.totalPages
                setHasMore(result.hasMore && result.page < MAX_SEARCH_PAGES)
                setErrorText(null)
                setItems((previous): StockPhoto[] => {
                    if (mode === 'first') {
                        return result.items
                    }
                    const seen = new Set(previous.map((item) => item.id))
                    return [...previous, ...result.items.filter((item) => !seen.has(item.id))]
                })
            } catch (cause) {
                if (seqRef.current !== seq) {
                    return
                }
                setErrorText(cause instanceof Error ? cause.message : String(cause))
                setHasMore(false)
                if (mode === 'first') {
                    setItems([])
                }
            } finally {
                if (seqRef.current === seq) {
                    setIsLoadingFirst(false)
                    setIsLoadingMore(false)
                }
            }
        },
        [query, orientation, topic, orderBy],
    )

    /** 关键词、方向、话题与排序变化：防抖后重搜第一页，同时把旧结果清掉以便骨架接管 */
    useEffect(() => {
        if (!isEnabled) {
            return
        }
        setItems([])
        setHasMore(false)
        const timer = setTimeout(() => {
            void runSearch(1, 'first')
        }, SEARCH_DEBOUNCE_MS)
        return (): void => {
            clearTimeout(timer)
        }
    }, [runSearch, isEnabled])

    const loadMore = useCallback((): void => {
        if (isLoadingFirst || isLoadingMore || !hasMore) {
            return
        }
        if (pageRef.current >= totalPagesRef.current) {
            return
        }
        void runSearch(pageRef.current + 1, 'more')
    }, [hasMore, isLoadingFirst, isLoadingMore, runSearch])

    const reload = useCallback((): void => {
        void runSearch(1, 'first')
    }, [runSearch])

    const retryThumb = useCallback((id: string): void => {
        void (async (): Promise<void> => {
            try {
                const result = await request<StockThumbResult>('stock/thumb', { id })
                if (result.thumbUrl === null) {
                    toast.error('缩略图仍无法获取，请稍后重试')
                    return
                }
                const thumbUrl = result.thumbUrl
                setItems((previous) => previous.map((item) => (item.id === id ? { ...item, thumbUrl } : item)))
            } catch (cause) {
                toastError(cause)
            }
        })()
    }, [])

    return {
        items,
        query,
        setQuery,
        orientation,
        setOrientation,
        orderBy,
        setOrderBy,
        topic,
        setTopic,
        isLoadingFirst,
        isLoadingMore,
        hasMore,
        errorText,
        loadMore,
        reload,
        retryThumb,
    }
}
