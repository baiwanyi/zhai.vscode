/**
 * 在线图库搜索钩子：关键词防抖、话题切换、分页追加、请求竞态丢弃与两种加载态。
 * 复用约定：搜索走 stock/search（话题 slug 与 refresh 一并带进载荷），缩略图补取走 stock/thumb，
 * 返回结构直接用宿主契约。
 * 关键约束：每次请求自增序号，响应回来时序号不一致即丢弃——否则快速改关键词会让旧结果盖掉新结果；
 * 话题与关键词互斥：切话题清空搜索词，输入搜索词即回到「推荐」（话题端点不接受关键词）；
 * 未配置密钥时 isEnabled 为 false，一个请求都不发；追加时按 photoId 过滤已存在的条目；
 * 浏览流与关键词搜索都按页续载（5 页封顶）：首屏只要第 1 页，滚动到底才要下一页；
 * 宿主按页缓存首页与续载页，未过期时零请求；当前列表每 8 小时自动强制刷新首页，
 * 刷新按钮走同一个入口，两者都只作用于当前列表；
 * 首屏加载与追加加载分开，骨架只在首屏出现；强制刷新保留旧列表，不闪骨架。
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

/** 自动加载页数上限：深翻页对选图没有收益，只烧配额；与宿主每列表最多缓存的页数（5 页）对齐 */
const MAX_SEARCH_PAGES = 5

/** 当前列表首页的自动刷新间隔：与宿主 unsplash.json 的按页 8 小时有效期同口径 */
const AUTO_SYNC_INTERVAL_MS = 8 * 60 * 60 * 1000

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
    /** 强制刷新进行中：页头的刷新入口据此展示「同步中」并禁用 */
    isSyncing: boolean
    hasMore: boolean
    /** 失败提示：冷却与未配置也走这里，页面据此展示空态 */
    errorText: string | null
    loadMore: () => void
    reload: () => void
    /** 强制刷新当前列表首页：跳过宿主对应页的缓存，「更多 - 刷新」与 8 小时定时用 */
    refresh: () => Promise<void>
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
    const [isSyncing, setIsSyncing] = useState(false)
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
        async (targetPage: number, mode: 'first' | 'more', isForce = false): Promise<void> => {
            seqRef.current += 1
            const seq = seqRef.current
            // 每次发起请求都重置同步位：普通查询与续载不算「同步中」，只有强制刷新才置位
            setIsSyncing(isForce)
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
                    refresh: isForce,
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
                // 强制刷新与续载下一页失败都只提示不动列表：已展示的页仍然可用，
                // 不该因为翻页那一次网络抖动把整屏变成错误页；继续滚动会再次触发这一页
                if (isForce || mode === 'more') {
                    toastError(cause)
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
                    setIsSyncing(false)
                }
            }
        },
        [query, orientation, topic, orderBy],
    )

    /**
     * 关键词、方向、话题与排序变化：立刻清空旧结果并进入骨架，防抖后再重搜第一页。
     * 关键约束：必须同时作废在途请求并点亮首屏加载态——只清 items 会让上一轮请求回来时
     * 把加载态关掉，页面先闪一帧「没有匹配的图片」再出骨架；顺序应为「骨架 → 列表 / 空态」。
     */
    useEffect(() => {
        if (!isEnabled) {
            return
        }
        seqRef.current += 1
        setIsLoadingFirst(true)
        setIsLoadingMore(false)
        setIsSyncing(false)
        setErrorText(null)
        setItems([])
        setHasMore(false)
        const timer = setTimeout(() => {
            void runSearch(1, 'first')
        }, SEARCH_DEBOUNCE_MS)
        return (): void => {
            clearTimeout(timer)
        }
    }, [runSearch, isEnabled])

    /**
     * 8 小时自动刷新：只刷当前列表（当前话题与筛选）的首页，不轮询其余已缓存列表。
     * 关键约束：定时器随筛选重建——换话题相当于重开计时，不会刚切过去就被后台刷新打断；
     * 续载页各有自己的 8 小时有效期，由宿主的按页过期判定兜底，这里只管首屏。
     */
    useEffect(() => {
        if (!isEnabled) {
            return
        }
        const timer = setInterval(() => {
            void runSearch(1, 'first', true)
        }, AUTO_SYNC_INTERVAL_MS)
        return (): void => {
            clearInterval(timer)
        }
    }, [isEnabled, runSearch])

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

    /** 强制刷新当前列表首页：跳过宿主对应页的缓存，「更多 - 刷新」用，与 8 小时定时器走同一入口 */
    const refresh = useCallback((): Promise<void> => runSearch(1, 'first', true), [runSearch])

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
        isSyncing,
        hasMore,
        errorText,
        loadMore,
        reload,
        refresh,
        retryThumb,
    }
}
