/**
 * 微博分组取数：一次取回默认分组与我的分组，供时间线取 list_id 与分组页展示。
 * 复用约定：协议走 weibo/groups，错误文案统一走 @shared/utils/error；
 * 时间线使用的 list_id 由宿主在结果里给出（timelineListId），页面不自行挑条目。
 * 关键约束：enabled 为假（未配置 Cookie）时不发任何请求，只回未配置状态；
 * 回包按请求序号校验，切换面板或重复刷新时旧回包直接丢弃，不覆盖新结果。
 */
import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { WeiboGroupsResult } from '@shared/types/weibo'
import { request } from '@shared/utils/bridge'
import { toErrorText, toastError } from '@shared/utils/error'

interface GroupsState {
    groups: WeiboGroupsResult | null
    isLoading: boolean
    errorMessage: string | null
}

type GroupsAction =
    | { type: 'start' }
    | { type: 'success'; groups: WeiboGroupsResult }
    | { type: 'failure'; message: string }
    | { type: 'disabled' }

const INITIAL_STATE: GroupsState = {
    groups: null,
    isLoading: false,
    errorMessage: null,
}

function reducer(state: GroupsState, action: GroupsAction): GroupsState {
    switch (action.type) {
        case 'start':
            return { ...state, isLoading: true, errorMessage: null }
        case 'success':
            return { groups: action.groups, isLoading: false, errorMessage: null }
        case 'failure':
            return { ...state, isLoading: false, errorMessage: action.message }
        case 'disabled':
            return INITIAL_STATE
        default:
            return state
    }
}

export interface WeiboGroupsController {
    state: GroupsState
    /** 重新读取分组：用于分组页的重试按钮 */
    reload: () => Promise<void>
}

interface UseWeiboGroupsOptions {
    /** 是否具备取数条件：未配置 Cookie 时保持静默 */
    enabled: boolean
}

/** 分组控制器：挂载后按需加载，结果含时间线的 list_id 与账号 uid */
export function useWeiboGroups({ enabled }: UseWeiboGroupsOptions): WeiboGroupsController {
    const [state, dispatch] = useReducer(reducer, INITIAL_STATE)
    // 请求序号：只有最后一次请求的回包允许落状态，切换面板或重复点击时旧的直接丢弃
    const requestSeq = useRef(0)

    const reload = useCallback(async (): Promise<void> => {
        const seq = requestSeq.current + 1
        requestSeq.current = seq
        dispatch({ type: 'start' })
        try {
            const groups = await request<WeiboGroupsResult>('weibo/groups')
            if (requestSeq.current !== seq) {
                return
            }
            dispatch({ type: 'success', groups })
        } catch (cause) {
            if (requestSeq.current !== seq) {
                return
            }
            dispatch({ type: 'failure', message: toErrorText(cause) })
            toastError(cause)
        }
    }, [])

    useEffect(() => {
        if (!enabled) {
            // 作废在途请求：未配置时不应把上一次的回包再写回状态
            requestSeq.current += 1
            dispatch({ type: 'disabled' })
            return
        }
        void reload()
    }, [enabled, reload])

    return { state, reload }
}
