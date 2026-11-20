/**
 * 热搜榜取数：侧栏挂载后取一次，可手动刷新。
 * 复用约定：协议走 weibo/hotRank，错误文案走 @shared/utils/error，页面只消费状态与动作。
 * 关键约束：未配置 Cookie 时不发请求，直接回未配置状态；
 * 首次启用读宿主缓存（StrictMode 双执行不会重复请求），按钮刷新才强制回源并覆盖缓存；
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

    /**
     * 取数：force 为真时跳过宿主缓存强制回源，对应热搜卡右上角的刷新按钮；
     * 首次挂载传 false，命中激活预热的结果即零网络。
     */
    const load = useCallback(
        async (force: boolean): Promise<void> => {
            if (!isEnabled) {
                return
            }
            const seq = seqRef.current + 1
            seqRef.current = seq
            dispatch({ type: 'start' })
            try {
                const payload = force ? { refresh: true } : undefined
                const result = await request<WeiboHotRankResult>('weibo/hotRank', payload)
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
        },
        [isEnabled],
    )

    const refresh = useCallback(async (): Promise<void> => {
        await load(true)
    }, [load])

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
        void load(false)
    }, [isEnabled, load])

    return { state, refresh }
}
