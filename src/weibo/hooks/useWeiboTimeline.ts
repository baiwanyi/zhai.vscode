/**
 * 关注时间线取数状态：凭证探测、刷新（含增量）、翻页、保存与清除 Cookie 集中在此。
 * 复用约定：协议经 @shared/utils/bridge 的 request 通道，方法名受 HostMethodName 约束；
 * 错误文案统一走 @shared/utils/error，页面只消费状态与动作，不自行拼请求参数。
 * 关键约束：刷新带上次结果的 sinceId 即增量，只有真正的新条目才前插并去重；
 * 首次进入先探测凭证，未配置不发请求，直接给配置引导；翻页到底必须清空 maxId，
 * 否则加载更多会被反复点亮；宿主返回的分类码原样保留，页面据此切到配置卡或提示稍后重试；
 * 屏蔽规则在返回前过滤，原始列表仍留在状态里，规则变化时无需回源即可即时重算。
 */
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import { toast } from 'sonner'
import type {
    WeiboBlockRules,
    WeiboCredentialState,
    WeiboSaveCredentialResult,
    WeiboTimelinePost,
    WeiboTimelineRequest,
    WeiboTimelineResult,
} from '@shared/types/weibo'
import { HostRequestError, request } from '@shared/utils/bridge'
import { toErrorText, toastError } from '@shared/utils/error'
import { EMPTY_WEIBO_BLOCK_RULES, filterWeiboPosts } from '@shared/utils/weiboBlock'
import { WEIBO_UI_TEXT } from '../utils/weiboUiText'

/** 取数模式：刷新走增量，翻页走 max_id */
type LoadMode = 'refresh' | 'more'

/** 单页条数：与网页端首屏一致 */
const PAGE_SIZE = 20

/** 翻页一次最多补两页：既有「加载更多」的即时反馈，又不至于一次点击打出长请求链 */
const MORE_MAX_PAGES = 2

interface TimelineState {
    posts: WeiboTimelinePost[]
    credential: WeiboCredentialState | null
    /** 首屏是否仍在读取：用于整页加载态 */
    isLoading: boolean
    errorCode: string | null
    errorMessage: string | null
    sinceId: string | null
    maxId: string | null
    hasMore: boolean
    isRefreshing: boolean
    isLoadingMore: boolean
    isSavingCredential: boolean
}

type TimelineAction =
    | { type: 'credential'; payload: WeiboCredentialState }
    | { type: 'refresh-start' }
    | { type: 'more-start' }
    | { type: 'refresh-success'; result: WeiboTimelineResult }
    | { type: 'more-success'; result: WeiboTimelineResult }
    | { type: 'prepend'; post: WeiboTimelinePost }
    | { type: 'failure'; code: string; message: string }
    | { type: 'saving'; value: boolean }
    | { type: 'cleared' }

const INITIAL_STATE: TimelineState = {
    posts: [],
    credential: null,
    isLoading: true,
    errorCode: null,
    errorMessage: null,
    sinceId: null,
    maxId: null,
    hasMore: false,
    isRefreshing: false,
    isLoadingMore: false,
    isSavingCredential: false,
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

function reducer(state: TimelineState, action: TimelineAction): TimelineState {
    switch (action.type) {
        case 'credential':
            return { ...state, credential: action.payload, isLoading: false, errorCode: null, errorMessage: null }
        case 'refresh-start':
            return {
                ...state,
                isRefreshing: true,
                isLoading: state.posts.length === 0,
                errorCode: null,
                errorMessage: null,
            }
        case 'more-start':
            return { ...state, isLoadingMore: true, errorCode: null, errorMessage: null }
        case 'refresh-success': {
            const posts = mergePosts(state.posts, action.result.posts, true)
            const maxId = action.result.maxId ?? state.maxId
            return {
                ...state,
                posts,
                sinceId: action.result.sinceId ?? state.sinceId,
                maxId,
                hasMore: maxId !== null && posts.length > 0,
                isRefreshing: false,
                isLoading: false,
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
            }
        }
        case 'prepend':
            // 发布成功：只把新微博插到最前，不动 sinceId / maxId，避免影响后续增量与翻页
            return { ...state, posts: mergePosts(state.posts, [action.post], true), isLoading: false }
        case 'failure':
            return {
                ...state,
                isRefreshing: false,
                isLoadingMore: false,
                isLoading: false,
                errorCode: action.code,
                errorMessage: action.message,
            }
        case 'saving':
            return { ...state, isSavingCredential: action.value }
        case 'cleared':
            return { ...INITIAL_STATE, isLoading: false, credential: { isConfigured: false, savedAt: null } }
        default:
            return state
    }
}

/** 读取宿主错误码：非宿主错误归一为 unknown */
function readErrorCode(cause: unknown): string {
    return cause instanceof HostRequestError ? cause.code : 'unknown'
}

export interface WeiboTimelineController {
    state: TimelineState
    /** 刷新：已加载过则带上 sinceId 做增量，否则拉最新一页 */
    refresh: () => Promise<void>
    /** 加载更多：沿上一页的 max_id 向后翻，游标为空时不动 */
    loadMore: () => Promise<void>
    /** 前插一条：发布成功后把新微博放到列表最前，不动游标也不回源 */
    prepend: (post: WeiboTimelinePost) => void
    /** 保存 Cookie：返回是否成功，失败时页面保留输入，避免用户重贴 */
    saveCredential: (cookie: string) => Promise<boolean>
    clearCredential: () => Promise<boolean>
}

/** 关注时间线控制器：页面挂载后自动探测凭证并加载首屏，返回前按屏蔽规则过滤 */
export function useWeiboTimeline(blockRules: WeiboBlockRules = EMPTY_WEIBO_BLOCK_RULES): WeiboTimelineController {
    const [state, dispatch] = useReducer(reducer, INITIAL_STATE)
    // 动作回调需要读最新游标，但不该因游标变化重建：用 ref 承载一份同步副本
    const stateRef = useRef(state)
    stateRef.current = state

    const loadPage = useCallback(
        async (mode: LoadMode, sinceId: string | null, maxId: string | null): Promise<void> => {
            dispatch({ type: mode === 'refresh' ? 'refresh-start' : 'more-start' })
            const payload: WeiboTimelineRequest =
                mode === 'refresh'
                    ? { count: PAGE_SIZE, maxPages: 1, ...(sinceId === null ? {} : { sinceId }) }
                    : { count: PAGE_SIZE, maxPages: MORE_MAX_PAGES, ...(maxId === null ? {} : { maxId }) }
            try {
                const result = await request<WeiboTimelineResult>('weibo/timeline', payload)
                dispatch({ type: mode === 'refresh' ? 'refresh-success' : 'more-success', result })
                if (mode === 'refresh' && result.posts.length === 0 && stateRef.current.posts.length > 0) {
                    toast(WEIBO_UI_TEXT.toast.noNewPosts)
                }
            } catch (cause) {
                dispatch({ type: 'failure', code: readErrorCode(cause), message: toErrorText(cause) })
                toastError(cause)
            }
        },
        [],
    )

    const refresh = useCallback(async (): Promise<void> => {
        await loadPage('refresh', stateRef.current.sinceId, null)
    }, [loadPage])

    const loadMore = useCallback(async (): Promise<void> => {
        const maxId = stateRef.current.maxId
        if (maxId === null) {
            return
        }
        await loadPage('more', null, maxId)
    }, [loadPage])

    const prepend = useCallback((post: WeiboTimelinePost): void => {
        dispatch({ type: 'prepend', post })
    }, [])

    const saveCredential = useCallback(
        async (cookie: string): Promise<boolean> => {
            dispatch({ type: 'saving', value: true })
            try {
                const result = await request<WeiboSaveCredentialResult>('weibo/credential/save', { cookie })
                dispatch({ type: 'credential', payload: result })
                toast.success(WEIBO_UI_TEXT.toast.credentialSaved)
                await loadPage('refresh', null, null)
                return true
            } catch (cause) {
                dispatch({ type: 'failure', code: readErrorCode(cause), message: toErrorText(cause) })
                toastError(cause)
                return false
            } finally {
                dispatch({ type: 'saving', value: false })
            }
        },
        [loadPage],
    )

    const clearCredential = useCallback(async (): Promise<boolean> => {
        try {
            await request('weibo/credential/clear')
            dispatch({ type: 'cleared' })
            toast.success(WEIBO_UI_TEXT.toast.credentialCleared)
            return true
        } catch (cause) {
            toastError(cause)
            return false
        }
    }, [])

    useEffect(() => {
        const bootstrap = async (): Promise<void> => {
            try {
                const credential = await request<WeiboCredentialState>('weibo/credential/status')
                dispatch({ type: 'credential', payload: credential })
                if (credential.isConfigured) {
                    await loadPage('refresh', null, null)
                }
            } catch (cause) {
                dispatch({ type: 'failure', code: readErrorCode(cause), message: toErrorText(cause) })
                toastError(cause)
            }
        }
        void bootstrap()
    }, [loadPage])

    // 屏蔽只在返回前做：状态里保留原始列表，规则变化（如「屏蔽该博主」）时无需回源即可重算
    const { blockedUsers, blockedKeywords } = blockRules
    const visiblePosts = useMemo(
        () => filterWeiboPosts(state.posts, { blockedUsers, blockedKeywords }),
        [blockedUsers, blockedKeywords, state.posts],
    )
    const visibleState = visiblePosts === state.posts ? state : { ...state, posts: visiblePosts }

    return useMemo(
        () => ({ state: visibleState, refresh, loadMore, prepend, saveCredential, clearCredential }),
        [clearCredential, loadMore, prepend, refresh, saveCredential, visibleState],
    )
}
