/**
 * 信息流取数状态：时间线、热门与分组共用一套「首屏 / 增量刷新 / 翻页」状态机。
 * 复用约定：协议走 weibo/feed，归一化后的帖子与首页同形，渲染统一交给 WeiboPostCard；
 * 错误文案走 @shared/utils/error，页面只消费状态与动作。
 * 关键约束：source 或 listId 变化即整条流重置，旧回包按请求序号与 key 双重校验后丢弃；
 * 翻页到底必须清空 maxId，否则「加载更多」会被反复点亮；未启用时不发请求也不转圈。
 */
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import { toast } from 'sonner'
import type { WeiboFeedSource, WeiboTimelinePost, WeiboTimelineResult } from '@shared/types/weibo'
import { WEIBO_FEED_DEFAULT_COUNT } from '@shared/types/weibo'
import { request } from '@shared/utils/bridge'
import { toErrorText, toastError } from '@shared/utils/error'

/** 翻页一次最多补两页：既有「加载更多」的即时反馈，又不至于一次点击打出长请求链 */
const MORE_MAX_PAGES = 2

/** 取数模式：刷新走增量，翻页走 max_id */
type LoadMode = 'refresh' | 'more'

export interface FeedState {
    posts: WeiboTimelinePost[]
    isLoading: boolean
    isLoadingMore: boolean
    isRefreshing: boolean
    /** 是否已完成过一次取数：首帧据此显示加载态，避免空态先闪一下 */
    hasLoaded: boolean
    errorMessage: string | null
    sinceId: string | null
    maxId: string | null
    hasMore: boolean
}

type FeedAction =
    | { type: 'reset' }
    | { type: 'refresh-start' }
    | { type: 'more-start' }
    | { type: 'refresh-success'; result: WeiboTimelineResult }
    | { type: 'more-success'; result: WeiboTimelineResult }
    | { type: 'failure'; message: string }

const INITIAL_STATE: FeedState = {
    posts: [],
    isLoading: false,
    isLoadingMore: false,
    isRefreshing: false,
    hasLoaded: false,
    errorMessage: null,
    sinceId: null,
    maxId: null,
    hasMore: false,
}

/** 按 id 合并：前插用于增量刷新，追加用于翻页；重复条目一律以首见为准 */
function mergePosts(
    current: WeiboTimelinePost[],
    incoming: WeiboTimelinePost[],
    isPrepend: boolean,
): WeiboTimelinePost[] {
    const ordered = isPrepend ? [...incoming, ...current] : [...current, ...incoming]
    const seen = new Set<string>()
    const merged: WeiboTimelinePost[] = []
    for (const post of ordered) {
        if (seen.has(post.id)) {
            continue
        }
        seen.add(post.id)
        merged.push(post)
    }
    return merged
}

function reducer(state: FeedState, action: FeedAction): FeedState {
    switch (action.type) {
        case 'reset':
            return INITIAL_STATE
        case 'refresh-start':
            return {
                ...state,
                isRefreshing: true,
                isLoading: state.posts.length === 0,
                errorMessage: null,
            }
        case 'more-start':
            return { ...state, isLoadingMore: true, errorMessage: null }
        case 'refresh-success': {
            const posts = mergePosts(state.posts, action.result.posts, true)
            // 增量只取一页，上游不返回 max_id：沿用上一次的游标，避免把翻页入口关掉
            const maxId = action.result.maxId ?? state.maxId
            return {
                ...state,
                posts,
                sinceId: action.result.sinceId ?? state.sinceId,
                maxId,
                hasMore: maxId !== null && posts.length > 0,
                isRefreshing: false,
                isLoading: false,
                hasLoaded: true,
            }
        }
        case 'more-success': {
            const posts = mergePosts(state.posts, action.result.posts, false)
            return {
                ...state,
                posts,
                maxId: action.result.maxId,
                hasMore: action.result.hasMore,
                isLoadingMore: false,
                hasLoaded: true,
            }
        }
        case 'failure':
            return {
                ...state,
                isRefreshing: false,
                isLoadingMore: false,
                isLoading: false,
                hasLoaded: true,
                errorMessage: action.message,
            }
        default:
            return state
    }
}

export interface WeiboFeedController {
    state: FeedState
    /** 刷新：已加载过则带上 sinceId 做增量，否则拉最新一页 */
    refresh: () => Promise<void>
    /** 加载更多：沿上一页的 max_id 向后翻，游标为空时不动 */
    loadMore: () => Promise<void>
}

interface UseWeiboFeedOptions {
    source: WeiboFeedSource
    /** 列表 id：分组为所选分组 gid，时间线为默认分组 gid，热门不需要 */
    listId: string | null
    /** 是否具备取数条件：未配置 Cookie 或未选定分组时为假 */
    enabled: boolean
}

/** 信息流控制器：key（来源 + 列表）变化即重置并重载首屏 */
export function useWeiboFeed({ source, listId, enabled }: UseWeiboFeedOptions): WeiboFeedController {
    const [state, dispatch] = useReducer(reducer, INITIAL_STATE)
    // 动作回调需要读最新游标，但不该因游标变化重建：用 ref 承载一份同步副本
    const stateRef = useRef(state)
    stateRef.current = state
    // 当前请求归属的 key 与序号：切换 tab 或重复点击时，旧回包一律丢弃
    const keyRef = useRef('')
    const seqRef = useRef(0)
    // 已加载过的 key：切走再切回沿用现有内容，不重复打同一接口
    const loadedKeyRef = useRef('')

    const load = useCallback(
        async (mode: LoadMode, requestKey: string, sinceId: string | null, maxId: string | null): Promise<void> => {
            if (listId === null) {
                return
            }
            const seq = seqRef.current + 1
            seqRef.current = seq
            dispatch({ type: mode === 'refresh' ? 'refresh-start' : 'more-start' })
            try {
                const result = await request<WeiboTimelineResult>('weibo/feed', {
                    source,
                    listId,
                    count: WEIBO_FEED_DEFAULT_COUNT,
                    maxPages: mode === 'more' ? MORE_MAX_PAGES : 1,
                    ...(sinceId === null ? {} : { sinceId }),
                    ...(maxId === null ? {} : { maxId }),
                })
                if (seqRef.current !== seq || keyRef.current !== requestKey) {
                    return
                }
                dispatch({ type: mode === 'refresh' ? 'refresh-success' : 'more-success', result })
                if (mode === 'refresh' && result.posts.length === 0 && stateRef.current.posts.length > 0) {
                    toast('暂无新内容')
                }
            } catch (cause) {
                if (seqRef.current !== seq || keyRef.current !== requestKey) {
                    return
                }
                dispatch({ type: 'failure', message: toErrorText(cause) })
                toastError(cause)
            }
        },
        [listId, source],
    )

    const refresh = useCallback(async (): Promise<void> => {
        if (listId === null) {
            return
        }
        await load('refresh', keyRef.current, stateRef.current.sinceId, null)
    }, [listId, load])

    const loadMore = useCallback(async (): Promise<void> => {
        const maxId = stateRef.current.maxId
        if (listId === null || maxId === null) {
            return
        }
        await load('more', keyRef.current, null, maxId)
    }, [listId, load])

    useEffect(() => {
        const requestKey = `${source}:${listId ?? ''}`
        keyRef.current = requestKey
        // 未启用或未选定列表：保留现有内容，切回时不必重新拉一次
        if (!enabled || listId === null) {
            return
        }
        if (loadedKeyRef.current === requestKey) {
            return
        }
        loadedKeyRef.current = requestKey
        // 切流先作废在途请求：旧流的回包不能再落到新流上
        seqRef.current += 1
        dispatch({ type: 'reset' })
        void load('refresh', requestKey, null, null)
    }, [enabled, listId, load, source])

    // 控制器对象按状态与动作 memo 化：页面把它放进 useCallback 依赖时才拿得到稳定引用
    return useMemo(() => ({ state, refresh, loadMore }), [state, refresh, loadMore])
}
