/**
 * 上下文候选的来源、分页与目标切换：按一级菜单选定的目标拉取最近内容，支持即时搜索与滚动加载。
 * 复用约定：请求走 @shared/utils/bridge 的 ai/context/sources 与 ai/context/query，错误经注入的 onError 上报；
 * 目标切换的接线（select / reset 经 ref 接力）也收在这里，调用方只传目标，不必自备 ref；
 * 与提及检索同源，只按标题与路径匹配，不做正文检索。
 * 关键约束：每次查询自增序号，过期回包一律丢弃；切换目标或关键词时重置偏移与结果；
 * 关键词为空即回到「最近内容」，与首页列表口径一致。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
    AiContextItem,
    AiContextQueryResult,
    AiContextSource,
    AiContextSourceResult,
    AiContextSourceScope,
} from '@shared/types/aiChat'
import { request } from '@shared/utils/bridge'
import { toErrorText } from '@shared/utils/error'
import type { AiContextTarget } from '../utils/context/types'

/** 单批条数：与「最近 20 篇 + 滚动加载」的交互一致 */
export const CONTEXT_PAGE_SIZE = 20

/** 候选查询对外暴露的状态与操作 */
export interface AiChatContextQueryState {
    target: AiContextTarget | null
    items: readonly AiContextItem[]
    hasMore: boolean
    isLoading: boolean
    /** 切换目标并发起首批查询：传 null 清空 */
    select: (target: AiContextTarget | null) => void
    /** 即时搜索：空串回到最近内容 */
    search: (keyword: string) => void
    /** 追加下一批：无更多或正在加载时短路 */
    loadMore: () => void
    reset: () => void
}

export function useAiChatContextQuery(onError: (error: string) => void): AiChatContextQueryState {
    const [target, setTarget] = useState<AiContextTarget | null>(null)
    const [items, setItems] = useState<readonly AiContextItem[]>([])
    const [hasMore, setHasMore] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const seqRef = useRef(0)
    const targetRef = useRef<AiContextTarget | null>(null)
    const keywordRef = useRef('')

    /** 拉取一页：offset 为 0 即替换结果，其余为追加 */
    const run = useCallback(
        async (next: AiContextTarget, keyword: string, offset: number): Promise<void> => {
            const seq = seqRef.current + 1
            seqRef.current = seq
            setIsLoading(true)
            try {
                const result = await request<AiContextQueryResult>('ai/context/query', {
                    ...next,
                    keyword,
                    offset,
                    limit: CONTEXT_PAGE_SIZE,
                })
                if (seqRef.current !== seq) {
                    return
                }
                setItems((current) => (offset === 0 ? result.items : [...current, ...result.items]))
                setHasMore(result.hasMore)
            } catch (cause) {
                if (seqRef.current === seq) {
                    setItems([])
                    setHasMore(false)
                    onError(toErrorText(cause))
                }
            } finally {
                if (seqRef.current === seq) {
                    setIsLoading(false)
                }
            }
        },
        [onError],
    )

    const select = useCallback(
        (next: AiContextTarget | null): void => {
            targetRef.current = next
            keywordRef.current = ''
            setTarget(next)
            setItems([])
            setHasMore(false)
            if (next !== null) {
                void run(next, '', 0)
            }
        },
        [run],
    )

    const search = useCallback(
        (keyword: string): void => {
            keywordRef.current = keyword
            const current = targetRef.current
            if (current === null) {
                return
            }
            void run(current, keyword.trim(), 0)
        },
        [run],
    )

    const loadMore = useCallback((): void => {
        const current = targetRef.current
        if (current === null || isLoading || !hasMore) {
            return
        }
        void run(current, keywordRef.current.trim(), items.length)
    }, [hasMore, isLoading, items.length, run])

    const reset = useCallback((): void => {
        seqRef.current += 1
        targetRef.current = null
        keywordRef.current = ''
        setTarget(null)
        setItems([])
        setHasMore(false)
        setIsLoading(false)
    }, [])

    return { target, items, hasMore, isLoading, select, search, loadMore, reset }
}

/** 来源列表：笔记本或作品，scope 为 null 时不请求 */
export interface AiChatContextSourcesState {
    sources: readonly AiContextSource[]
    isLoading: boolean
}

export function useAiChatContextSources(
    scope: AiContextSourceScope | null,
    onError: (error: string) => void,
): AiChatContextSourcesState {
    const [sources, setSources] = useState<readonly AiContextSource[]>([])
    // 初始按 scope 判定：请求在 effect 里发起，初始为 false 会让调用方先闪一帧空状态
    const [isLoading, setIsLoading] = useState(scope !== null)

    useEffect((): (() => void) => {
        if (scope === null) {
            setSources([])
            setIsLoading(false)
            return (): void => undefined
        }
        let isActive = true
        setIsLoading(true)
        void request<AiContextSourceResult>('ai/context/sources', { scope })
            .then((result) => {
                if (isActive) {
                    setSources(result.sources)
                }
            })
            .catch((cause: unknown) => {
                if (isActive) {
                    setSources([])
                    onError(toErrorText(cause))
                }
            })
            .finally(() => {
                if (isActive) {
                    setIsLoading(false)
                }
            })
        return (): void => {
            isActive = false
        }
    }, [scope, onError])

    return { sources, isLoading }
}

/**
 * 查询目标切换：目标变化即选新目标并发起首批查询，传 null 清空查询与结果。
 * 复用约定：select / reset 先落到 ref 再进依赖，避免它们每次渲染换引用就重发同一批查询；
 * 与 useAiChatContextQuery 同域，故不单独建文件。
 * 关键约束：target 的引用稳定性由调用方保证——每次渲染新建的字面量会让本效果重发查询。
 */
export function useContextQueryTarget(
    query: Pick<AiChatContextQueryState, 'reset' | 'select'>,
    target: AiContextTarget | null,
): void {
    const selectRef = useRef(query.select)
    const resetRef = useRef(query.reset)

    useEffect((): void => {
        selectRef.current = query.select
        resetRef.current = query.reset
    }, [query.reset, query.select])

    useEffect((): void => {
        if (target === null) {
            resetRef.current()
            return
        }
        selectRef.current(target)
    }, [target])
}
