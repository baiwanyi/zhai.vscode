/**
 * 同城城市：设置弹窗读取当前生效城市并保存，热搜「同城」榜据此拼 citycode。
 * 复用约定：协议走 weibo/city/status 与 weibo/city/save，错误文案走 @shared/utils/error，
 * 页面只消费状态与动作，城市清单与展示名由 @shared/types/weibo 给出。
 * 关键约束：与 Cookie 无关——未配置凭证也能查看与修改，城市只影响同城榜单；
 * 挂载即读取一次，保存成功后直接用回包替换本地状态，不必再回源。
 */
import { useCallback, useEffect, useReducer } from 'react'
import { toast } from 'sonner'
import type { WeiboCityState, WeiboSaveCityRequest } from '@shared/types/weibo'
import { request } from '@shared/utils/bridge'
import { toErrorText, toastError } from '@shared/utils/error'

interface CityState {
    /** 四位行政区划代码：读取完成前为空串 */
    cityCode: string
    cityName: string
    isLoading: boolean
    isSaving: boolean
    errorMessage: string | null
}

type CityAction =
    | { type: 'start' }
    | { type: 'success'; payload: WeiboCityState }
    | { type: 'failure'; message: string }
    | { type: 'saving'; value: boolean }

const INITIAL_STATE: CityState = {
    cityCode: '',
    cityName: '',
    isLoading: true,
    isSaving: false,
    errorMessage: null,
}

function reducer(state: CityState, action: CityAction): CityState {
    switch (action.type) {
        case 'start':
            return { ...state, isLoading: true, errorMessage: null }
        case 'success':
            return {
                cityCode: action.payload.cityCode,
                cityName: action.payload.cityName,
                isLoading: false,
                isSaving: false,
                errorMessage: null,
            }
        case 'failure':
            return { ...state, isLoading: false, isSaving: false, errorMessage: action.message }
        case 'saving':
            return { ...state, isSaving: action.value }
        default:
            return state
    }
}

export interface WeiboCityController {
    state: CityState
    /** 保存城市：返回是否成功，失败时调用方保留原选中值 */
    save: (cityCode: string) => Promise<boolean>
}

/** 城市控制器：挂载读取一次，保存后以回包为准更新展示名 */
export function useWeiboCity(): WeiboCityController {
    const [state, dispatch] = useReducer(reducer, INITIAL_STATE)

    useEffect(() => {
        const load = async (): Promise<void> => {
            dispatch({ type: 'start' })
            try {
                const result = await request<WeiboCityState>('weibo/city/status')
                dispatch({ type: 'success', payload: result })
            } catch (cause) {
                dispatch({ type: 'failure', message: toErrorText(cause) })
            }
        }
        void load()
    }, [])

    const save = useCallback(async (cityCode: string): Promise<boolean> => {
        dispatch({ type: 'saving', value: true })
        try {
            const payload: WeiboSaveCityRequest = { cityCode }
            const result = await request<WeiboCityState>('weibo/city/save', payload)
            dispatch({ type: 'success', payload: result })
            toast.success(`同城榜单已切换到 ${result.cityName}`)
            return true
        } catch (cause) {
            dispatch({ type: 'failure', message: toErrorText(cause) })
            toastError(cause)
            return false
        }
    }, [])

    return { state, save }
}
