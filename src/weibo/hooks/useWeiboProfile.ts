/**
 * 账号信息取数：顶栏账号菜单挂载后取一次，用户资料与头像都由宿主回包给出。
 * 复用约定：协议走 weibo/profile，头像已是宿主从本地文件生成的 data URI，前端不再经 useWeiboImage；
 * 错误文案走 @shared/utils/error，页面只消费状态与动作。
 * 关键约束：未配置 Cookie 时不发请求（宿主侧也拿不到 uid 去取资料）；
 * 失败不弹窗——只是顶栏没有头像与昵称，不该在打开面板时打扰用户；回包按序号校验，旧回包直接丢弃。
 */
import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { WeiboProfile, WeiboProfileResult } from '@shared/types/weibo'
import { WEIBO_METHODS } from '@shared/types/weiboMethods'
import { request } from '@shared/utils/bridge'
import { toErrorText } from '@shared/utils/error'

interface ProfileState {
    profile: WeiboProfile | null
    avatarDataUrl: string | null
    isLoading: boolean
    errorMessage: string | null
}

type ProfileAction =
    | { type: 'start' }
    | { type: 'success'; result: WeiboProfileResult }
    | { type: 'failure'; message: string }
    | { type: 'disabled' }

const INITIAL_STATE: ProfileState = {
    profile: null,
    avatarDataUrl: null,
    isLoading: false,
    errorMessage: null,
}

function reducer(state: ProfileState, action: ProfileAction): ProfileState {
    switch (action.type) {
        case 'start':
            return { ...state, isLoading: true, errorMessage: null }
        case 'success':
            return {
                profile: action.result.profile,
                avatarDataUrl: action.result.avatarDataUrl,
                isLoading: false,
                errorMessage: null,
            }
        case 'failure':
            return { ...state, isLoading: false, errorMessage: action.message }
        case 'disabled':
            return INITIAL_STATE
        default:
            return state
    }
}

export interface WeiboProfileController {
    state: ProfileState
    /** 重新读取账号信息：命中宿主缓存时零网络 */
    reload: () => Promise<void>
}

/** 账号信息控制器：启用后取一次，结果常驻直到面板重建 */
export function useWeiboProfile(isEnabled: boolean): WeiboProfileController {
    const [state, dispatch] = useReducer(reducer, INITIAL_STATE)
    const seqRef = useRef(0)

    const reload = useCallback(async (): Promise<void> => {
        if (!isEnabled) {
            return
        }
        const seq = seqRef.current + 1
        seqRef.current = seq
        dispatch({ type: 'start' })
        try {
            const result = await request<WeiboProfileResult>(WEIBO_METHODS.profile)
            if (seqRef.current !== seq) {
                return
            }
            dispatch({ type: 'success', result })
        } catch (cause) {
            if (seqRef.current !== seq) {
                return
            }
            dispatch({ type: 'failure', message: toErrorText(cause) })
        }
    }, [isEnabled])

    useEffect(() => {
        if (!isEnabled) {
            // 作废在途请求：清除凭证后旧回包不应再写回状态
            seqRef.current += 1
            dispatch({ type: 'disabled' })
            return
        }
        void reload()
    }, [isEnabled, reload])

    return { state, reload }
}
