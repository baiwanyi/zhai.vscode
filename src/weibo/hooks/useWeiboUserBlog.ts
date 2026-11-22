/**
 * 他人主页取数：按 uid 或昵称读取用户资料与该用户的微博列表，首屏与翻页共用一套状态机。
 * 复用约定：协议走 weibo/userBlog，帖子与首页同形，渲染交给 WeiboFeedSection / WeiboPostCard；
 * 错误文案走 @shared/utils/error，页面只消费状态与动作。
 * 关键约束：主页列表只有页码分页，刷新重取第一页并整体替换，翻页按 page + 1 追加去重；
 * 目标（uid 或昵称）变化即重置并重取首屏，旧回包按请求序号丢弃；
 * 同一用户的资料不随翻页替换——上游头像地址带签名，换一次就会多下载一次；
 * 屏蔽规则在返回前过滤，页码与总数仍按上游口径保留。
 */
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import { toast } from 'sonner'
import type { WeiboBlockRules, WeiboUserBlogResult, WeiboUserInfo, WeiboTimelinePost } from '@shared/types/weibo'
import { WEIBO_METHODS } from '@shared/types/weiboMethods'
import { request } from '@shared/utils/bridge'
import { toErrorText, toastError } from '@shared/utils/error'
import { EMPTY_WEIBO_BLOCK_RULES, filterWeiboPosts } from '@shared/utils/weiboBlock'
import type { WeiboUserTarget } from '../utils/weiboLinks'
import type { FeedState, WeiboFeedController } from './useWeiboFeed'

/** 取数模式：刷新重取第一页，翻页按下一页页码追加 */
type LoadMode = 'refresh' | 'more'

/** 主页状态：在信息流状态之上补资料、页码与总数，渲染层仍按 WeiboFeedController 消费 */
export interface UserBlogState extends FeedState {
    user: WeiboUserInfo | null
    /** 已加载到的页码：从 1 开始，0 表示还没取过 */
    page: number
    /** 上游声明的微博总数：缺失为 null */
    total: number | null
}

type UserBlogAction =
    | { type: 'reset' }
    | { type: 'refresh-start' }
    | { type: 'more-start' }
    | { type: 'refresh-success'; result: WeiboUserBlogResult }
    | { type: 'more-success'; result: WeiboUserBlogResult }
    | { type: 'failure'; message: string }

const INITIAL_STATE: UserBlogState = {
    posts: [],
    isLoading: false,
    isLoadingMore: false,
    isRefreshing: false,
    hasLoaded: false,
    errorMessage: null,
    // 主页列表没有上游游标：这两个字段恒为 null，只为与信息流状态同形
    sinceId: null,
    maxId: null,
    hasMore: false,
    user: null,
    page: 0,
    total: null,
}

/** 追加去重：翻页重叠加了同一批条目时以首见为准 */
function appendPosts(current: WeiboTimelinePost[], incoming: WeiboTimelinePost[]): WeiboTimelinePost[] {
    const seen = new Set(current.map((post) => post.id))
    const merged = [...current]
    for (const post of incoming) {
        if (seen.has(post.id)) {
            continue
        }
        seen.add(post.id)
        merged.push(post)
    }
    return merged
}

/**
 * 资料合并：同一用户沿用已有资料，避免签名头像地址每次刷新都变。
 * 换用户（id 不同）或首次到货时才整份替换。
 */
function mergeUser(current: WeiboUserInfo | null, incoming: WeiboUserInfo): WeiboUserInfo {
    return current !== null && current.id === incoming.id ? current : incoming
}

function reducer(state: UserBlogState, action: UserBlogAction): UserBlogState {
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
                user: mergeUser(state.user, action.result.user),
                posts: action.result.posts,
                page: action.result.page,
                total: action.result.total,
                hasMore: action.result.hasMore,
                isRefreshing: false,
                isLoading: false,
                hasLoaded: true,
            }
        case 'more-success': {
            const posts = appendPosts(state.posts, action.result.posts)
            return {
                ...state,
                user: mergeUser(state.user, action.result.user),
                posts,
                page: action.result.page,
                total: action.result.total,
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

/** 主页控制器：比通用信息流多出资料、页码与总数，渲染层可直接读 user */
export interface WeiboUserBlogController extends WeiboFeedController {
    state: UserBlogState
}

/** 目标键：uid 与昵称各自成键，切换用户时据此重置 */
function toTargetKey(target: WeiboUserTarget | null): string {
    return target === null ? '' : `${target.kind}:${target.value}`
}

/**
 * 主页控制器：目标非空且已配置 Cookie 时自动取首屏，返回前按屏蔽规则过滤。
 * 关键约束：没有目标（未打开主页）时不发请求也不转圈；清除凭证后作废在途请求并清空状态。
 */
export function useWeiboUserBlog(
    target: WeiboUserTarget | null,
    isEnabled: boolean,
    blockRules: WeiboBlockRules = EMPTY_WEIBO_BLOCK_RULES,
): WeiboUserBlogController {
    const [state, dispatch] = useReducer(reducer, INITIAL_STATE)
    // 翻页要读最新页码，但不该因页码变化重建回调：用 ref 承载一份同步副本
    const stateRef = useRef(state)
    stateRef.current = state
    // 目标随渲染更新：请求发起时读它，避免把对象放进回调依赖
    const targetRef = useRef(target)
    targetRef.current = target
    const key = toTargetKey(target)
    // 请求归属的键与序号：切换用户或重复点击时，旧回包一律丢弃
    const keyRef = useRef(key)
    const seqRef = useRef(0)

    const load = useCallback(async (mode: LoadMode, requestKey: string, page: number): Promise<void> => {
        const current = targetRef.current
        if (current === null) {
            return
        }
        const seq = seqRef.current + 1
        seqRef.current = seq
        dispatch({ type: mode === 'refresh' ? 'refresh-start' : 'more-start' })
        try {
            const result = await request<WeiboUserBlogResult>(WEIBO_METHODS.userBlog, {
                ...(current.kind === 'uid' ? { uid: current.value } : { screenName: current.value }),
                page,
            })
            if (seqRef.current !== seq || keyRef.current !== requestKey) {
                return
            }
            dispatch({ type: mode === 'refresh' ? 'refresh-success' : 'more-success', result })
            if (mode === 'refresh' && result.posts.length === 0 && stateRef.current.posts.length > 0) {
                toast('这个主页暂时没有新微博')
            }
        } catch (cause) {
            if (seqRef.current !== seq || keyRef.current !== requestKey) {
                return
            }
            dispatch({ type: 'failure', message: toErrorText(cause) })
            toastError(cause)
        }
    }, [])

    const refresh = useCallback(async (): Promise<void> => {
        await load('refresh', keyRef.current, 1)
    }, [load])

    const loadMore = useCallback(async (): Promise<void> => {
        const current = stateRef.current
        if (!current.hasMore) {
            return
        }
        await load('more', keyRef.current, current.page + 1)
    }, [load])

    useEffect(() => {
        keyRef.current = key
        // 目标为空或未配置：清空状态并作废在途请求，返回主页时重新取首屏
        seqRef.current += 1
        dispatch({ type: 'reset' })
        if (key === '' || !isEnabled) {
            return
        }
        void load('refresh', key, 1)
    }, [isEnabled, key, load])

    // 屏蔽只在返回前做：状态里保留原始列表，页码与总数仍按上游口径保留
    const { blockedUsers, blockedKeywords } = blockRules
    const visiblePosts = useMemo(
        () => filterWeiboPosts(state.posts, { blockedUsers, blockedKeywords }),
        [blockedKeywords, blockedUsers, state.posts],
    )
    const visibleState = visiblePosts === state.posts ? state : { ...state, posts: visiblePosts }

    // 控制器对象按状态与动作 memo 化：页面把它放进 useCallback 依赖时才拿得到稳定引用
    return useMemo<WeiboUserBlogController>(
        () => ({ state: visibleState, refresh, loadMore }),
        [visibleState, refresh, loadMore],
    )
}
