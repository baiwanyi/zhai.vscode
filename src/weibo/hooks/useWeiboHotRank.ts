/**
 * 热搜榜取数：侧栏挂载后取一次，可手动刷新。
 * 复用约定：协议走 weibo/hotRank，错误文案走 @shared/utils/error，页面只消费状态与动作。
 * 关键约束：未配置 Cookie 时不发请求，直接回未配置状态；
 * 首次启用只取一次（StrictMode 双执行不会重复请求），后续刷新由按钮触发；
 * 回包按请求序号校验，重复点击时旧回包直接丢弃。
 */
import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { WeiboHotRankItem, WeiboHotRankResult } from '@shared/types/weibo'
import { request } from '@shared/utils/bridge'
import { toErrorText, toastError } from '@shared/utils/error'

interface HotRankState {
    items: WeiboHotRankItem[]
    isLoading: boolean
    errorMessage: string | null
    fetchedAt: string | null
}

type HotRankAction =
    | { type: 'start' }
    | { type: 'success'; result: WeiboHotRankResult }
    | { type: 'failure'; message: string }
    | { type: 'disabled' }

const INITIAL_STATE: HotRankState = {
    items: [],
    isLoading: false,
    errorMessage: null,
    fetchedAt: null,
}

function reducer(state: HotRankState, action: HotRankAction): HotRankState {
    switch (action.type) {
        case 'start':
            return { ...state, isLoading: true, errorMessage: null }
        case 'success':
            return {
                items: action.result.items,
                isLoading: false,
                errorMessage: null,
                fetchedAt: action.result.fetchedAt,
            }
        case 'failure':
            return { ...state, isLoading: false, errorMessage: action.message }
        case 'disabled':
            return INITIAL_STATE
        default:
            return state
    }
}

export interface WeiboHotRankController {
    state: HotRankState
    /** 手动刷新：未启用时不动 */
    refresh: () => Promise<void>
}

/** 热搜榜控制器：启用后自动取一次，结果常驻直到手动刷新 */
export function useWeiboHotRank(isEnabled: boolean): WeiboHotRankController {
    const [state, dispatch] = useReducer(reducer, INITIAL_STATE)
    const seqRef = useRef(0)
    // 首次启用已取过数：避免 StrictMode 双执行与重复挂载打出重复请求
    const hasStartedRef = useRef(false)

    const refresh = useCallback(async (): Promise<void> => {
        if (!isEnabled) {
            return
        }
        const seq = seqRef.current + 1
        seqRef.current = seq
        dispatch({ type: 'start' })
        try {
            const result = await request<WeiboHotRankResult>('weibo/hotRank')
            if (seqRef.current !== seq) {
                return
            }
            dispatch({ type: 'success', result })
        } catch (cause) {
            if (seqRef.current !== seq) {
                return
            }
            dispatch({ type: 'failure', message: toErrorText(cause) })
            toastError(cause)
        }
    }, [isEnabled])

    useEffect(() => {
        if (!isEnabled) {
            seqRef.current += 1
            hasStartedRef.current = false
            dispatch({ type: 'disabled' })
            return
        }
        if (hasStartedRef.current) {
            return
        }
        hasStartedRef.current = true
        void refresh()
    }, [isEnabled, refresh])

    return { state, refresh }
}
