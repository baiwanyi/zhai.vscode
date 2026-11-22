/**
 * 我的赞取数：按页码读取登录账号点赞过的微博，首屏与翻页共用一套状态机。
 * 复用约定：协议走 weibo/likes，帖子与首页同形，渲染仍交给 WeiboFeedList / WeiboPostCard；
 * 错误文案走 @shared/utils/error，页面只消费状态与动作。
 * 关键约束：点赞列表只有页码分页，刷新重取第一页并整体替换，翻页按 page + 1 追加去重；
 * 到底后不再递增页码，避免「加载更多」被反复点亮；未启用时不发请求也不转圈，
 * 切走再切回沿用已取内容，不重复打同一页；屏蔽规则在返回前过滤，页码与总数仍按上游口径保留。
 */
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import { toast } from 'sonner'
import type { WeiboBlockRules, WeiboLikesResult } from '@shared/types/weibo'
import { WEIBO_METHODS } from '@shared/types/weiboMethods'
import { request } from '@shared/utils/bridge'
import { toErrorText, toastError } from '@shared/utils/error'
import { mergeById } from '@shared/utils/mergeById'
import { EMPTY_WEIBO_BLOCK_RULES, filterWeiboPosts } from '@shared/utils/weiboBlock'
import type { FeedState, WeiboFeedController } from './useWeiboFeed'

/** 取数模式：刷新重取第一页，翻页按下一页页码追加 */
type LoadMode = 'refresh' | 'more'

interface LikesState extends FeedState {
    /** 已加载到的页码：从 1 开始，0 表示还没取过 */
    page: number
    /** 上游声明的点赞总数：缺失为 null，仅用于说明当前覆盖范围 */
    totalNumber: number | null
}

type LikesAction =
    | { type: 'reset' }
    | { type: 'refresh-start' }
    | { type: 'more-start' }
    | { type: 'refresh-success'; result: WeiboLikesResult }
    | { type: 'more-success'; result: WeiboLikesResult }
    | { type: 'failure'; message: string }

const INITIAL_STATE: LikesState = {
    posts: [],
    isLoading: false,
    isLoadingMore: false,
    isRefreshing: false,
    hasLoaded: false,
    errorMessage: null,
    // 点赞列表没有上游游标：这两个字段恒为 null，只为与信息流状态同形
    sinceId: null,
    maxId: null,
    hasMore: false,
    page: 0,
    totalNumber: null,
}

function reducer(state: LikesState, action: LikesAction): LikesState {
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
        case 'refresh-success':
            return {
                ...state,
                posts: action.result.posts,
                page: action.result.page,
                totalNumber: action.result.totalNumber,
                hasMore: action.result.hasMore,
                isRefreshing: false,
                isLoading: false,
                hasLoaded: true,
            }
        case 'more-success': {
            const posts = mergeById(state.posts, action.result.posts)
            return {
                ...state,
                posts,
                page: action.result.page,
                totalNumber: action.result.totalNumber,
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

/** 我的赞控制器：只在点赞视图激活时启用，启用后自动取第一页，返回前按屏蔽规则过滤 */
export function useWeiboLikes(
    isEnabled: boolean,
    blockRules: WeiboBlockRules = EMPTY_WEIBO_BLOCK_RULES,
): WeiboFeedController {
    const [state, dispatch] = useReducer(reducer, INITIAL_STATE)
    // 翻页要读最新页码，但不该因页码变化重建回调：用 ref 承载一份同步副本
    const stateRef = useRef(state)
    stateRef.current = state
    // 请求序号：切换视图或重复点击时，旧回包一律丢弃
    const seqRef = useRef(0)
    // 是否已取过首屏：切走再切回不重复拉同一页
    const hasLoadedRef = useRef(false)

    const load = useCallback(async (mode: LoadMode, page: number): Promise<void> => {
        const seq = seqRef.current + 1
        seqRef.current = seq
        dispatch({ type: mode === 'refresh' ? 'refresh-start' : 'more-start' })
        try {
            const result = await request<WeiboLikesResult>(WEIBO_METHODS.likes, { page })
            if (seqRef.current !== seq) {
                return
            }
            dispatch({ type: mode === 'refresh' ? 'refresh-success' : 'more-success', result })
            if (mode === 'refresh' && result.posts.length === 0 && stateRef.current.posts.length > 0) {
                toast('点赞列表暂时是空的')
            }
        } catch (cause) {
            if (seqRef.current !== seq) {
                return
            }
            dispatch({ type: 'failure', message: toErrorText(cause) })
            toastError(cause)
        }
    }, [])

    const refresh = useCallback(async (): Promise<void> => {
        await load('refresh', 1)
    }, [load])

    const loadMore = useCallback(async (): Promise<void> => {
        const current = stateRef.current
        if (!current.hasMore) {
            return
        }
        await load('more', current.page + 1)
    }, [load])

    useEffect(() => {
        if (!isEnabled) {
            // 作废在途请求：离开视图后旧回包不应再写回状态
            seqRef.current += 1
            return
        }
        if (hasLoadedRef.current) {
            return
        }
        hasLoadedRef.current = true
        void load('refresh', 1)
    }, [isEnabled, load])

    // 屏蔽只在返回前做：状态里保留原始列表，页码与总数仍按上游口径保留
    const { blockedUsers, blockedKeywords } = blockRules
    const visiblePosts = useMemo(
        () => filterWeiboPosts(state.posts, { blockedUsers, blockedKeywords }),
        [blockedUsers, blockedKeywords, state.posts],
    )
    const visibleState = visiblePosts === state.posts ? state : { ...state, posts: visiblePosts }

    // 控制器对象按状态与动作 memo 化：页面把它放进 useCallback 依赖时才拿得到稳定引用
    return useMemo(() => ({ state: visibleState, refresh, loadMore }), [visibleState, refresh, loadMore])
}
