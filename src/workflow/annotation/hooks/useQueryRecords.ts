/**
 * AI 解释记录：标注总览页的跨文档列举、滚动续载与删除。
 * 复用约定：协议走 bridge 的 annotation/queries 系列，类型取 @shared/types/editor；
 * 关键词由调用方（页面顶部搜索框）传入，本层不持有输入状态，300ms 防抖与标注列表同一节奏。
 * 关键约束：分页按 offset 追加并按 id 去重——记录可能在别处被删、offset 会偏，不去重会出重复条目；
 * hasMore 以「已加载条数 < 总数」判定，不额外维护游标；
 * 关键词变化即回到首页并整表替换，不能把上一个关键词的条目留在列表里；首页请求不受续载闸门限制；
 * 删除只在成功后从当前列表移除并同步收敛总数，不做整页刷新；
 * 删除成功后经 onRemoved 通知外部刷新页头统计——统计不归本层持有，否则两个数字会打架。
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
    /** 首页加载中：只在换关键词时置位，空态与骨架据此显示 */
    isLoading: boolean
    /** 续载中：哨兵专用于显示转圈，不与首屏空态的骨架抢状态 */
    isLoadingMore: boolean
    hasMore: boolean
    error: string | null
    loadMore: () => Promise<void>
    remove: (id: string) => Promise<void>
}

/**
 * @param keyword 外部搜索词：与标注列表共用页面顶部那一个输入框
 * @param onRemoved 删除成功后的通知：页头统计与列表同源，须由外部据此刷新
 */
export function useQueryRecords(keyword: string, onRemoved?: (id: string) => void): UseQueryRecordsResult {
    const [items, setItems] = useState<EditorQueryRecord[]>([])
    const [total, setTotal] = useState(0)
    const [isLoading, setIsLoading] = useState(false)
    const [isLoadingMore, setIsLoadingMore] = useState(false)
    const [error, setError] = useState<string | null>(null)
    /** 请求闸门：哨兵可能连续触发，同一时刻只允许一页在飞 */
    const isLoadingRef = useRef(false)
    /** 请求序号：并发时只认最后一次，旧响应回来即作废 */
    const requestSeqRef = useRef(0)

    const fetchPage = useCallback(async (nextKeyword: string, offset: number): Promise<void> => {
        // 续载保留闸门；换关键词的首页请求不受限，否则会被在飞的续载吞掉，表现为「搜索没反应」
        if (offset > 0 && isLoadingRef.current) {
            return
        }
        requestSeqRef.current += 1
        const seq = requestSeqRef.current
        isLoadingRef.current = true
        if (offset === 0) {
            setIsLoading(true)
        } else {
            setIsLoadingMore(true)
        }
        try {
            const result = await request<EditorQueryListResult>('annotation/queries', {
                keyword: nextKeyword,
                limit: PAGE_LIMIT,
                offset,
            })
            // 过期响应：期间已换了关键词或重拉了首页，本次结果作废
            if (seq !== requestSeqRef.current) {
                return
            }
            setItems((previous) => {
                if (offset === 0) {
                    return result.items
                }
                // 按 id 去重：记录可能在别处被删，offset 会偏，重复追加会让列表出现重复 key
                const loadedIds = new Set(previous.map((item) => item.id))
                return [...previous, ...result.items.filter((item) => !loadedIds.has(item.id))]
            })
            setTotal(result.total)
            setError(null)
        } catch {
            if (seq === requestSeqRef.current) {
                setError('加载 AI 解释记录失败，请稍后重试')
            }
        } finally {
            // 只在最新请求结束时释放闸门与加载态，旧请求不得干扰新请求
            if (seq === requestSeqRef.current) {
                isLoadingRef.current = false
                setIsLoading(false)
                setIsLoadingMore(false)
            }
        }
    }, [])

    // 关键词变化即回到首页：防抖期间用户还在输入，不必每敲一个字都打库
    useEffect(() => {
        const timer = setTimeout((): void => {
            void fetchPage(keyword, 0)
        }, SEARCH_DEBOUNCE_MS)
        return (): void => {
            clearTimeout(timer)
        }
    }, [fetchPage, keyword])

    const loadMore = useCallback(async (): Promise<void> => {
        await fetchPage(keyword, items.length)
    }, [fetchPage, items.length, keyword])

    const remove = useCallback(
        async (id: string): Promise<void> => {
            try {
                await request('annotation/query/remove', { id })
                // 局部更新：不重拉列表，用户滚到中间删一条不该被弹回顶部
                setItems((previous) => previous.filter((item) => item.id !== id))
                setTotal((previous) => Math.max(previous - 1, 0))
                // 统计由外部刷新：本层拿不到页头，只能把「已删除」这件事实报出去
                onRemoved?.(id)
            } catch {
                setError('删除失败，请稍后重试')
            }
        },
        [onRemoved],
    )

    return { items, isLoading, isLoadingMore, hasMore: items.length < total, error, loadMore, remove }
}
