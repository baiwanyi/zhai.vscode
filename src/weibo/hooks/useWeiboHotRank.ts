/**
 * 热搜榜取数：侧栏默认榜与热搜页各标签共用，按「来源 + 同城城市」切换重取。
 * 复用约定：协议走 weibo/hotRank（tab / cityCode 由宿主映射到具体端点），错误文案走 @shared/utils/error，
 * 页面只消费状态与动作，不自行拼请求参数。
 * 关键约束：未配置 Cookie 时不发请求，直接回空状态；同一 key 已取过则切回不重复打接口；
 * 每次取数按请求序号与 key 双重校验，切标签或重复点击时旧回包直接丢弃。
 */
import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { WeiboHotRankItem, WeiboHotRankRequest, WeiboHotRankResult, WeiboHotRankTab } from '@shared/types/weibo'
import { request } from '@shared/utils/bridge'
import { toErrorText, toastError } from '@shared/utils/error'

/** 榜单状态：取数提升到面板层后，热搜页与顶栏刷新共用这一份 */
export interface WeiboHotRankState {
    items: WeiboHotRankItem[]
    isLoading: boolean
    /** 是否已完成过一次取数（成功或失败）：首帧据此显示加载态，避免空态先闪一下 */
    hasLoaded: boolean
    errorMessage: string | null
    fetchedAt: string | null
}

type HotRankAction =
    | { type: 'start' }
    | { type: 'success'; result: WeiboHotRankResult }
    | { type: 'failure'; message: string }
    | { type: 'reset' }
    | { type: 'disabled' }

const INITIAL_STATE: WeiboHotRankState = {
    items: [],
    isLoading: false,
    hasLoaded: false,
    errorMessage: null,
    fetchedAt: null,
}

function reducer(state: WeiboHotRankState, action: HotRankAction): WeiboHotRankState {
    switch (action.type) {
        case 'start':
            return { ...state, isLoading: true, errorMessage: null }
        case 'success':
            return {
                items: action.result.items,
                isLoading: false,
                hasLoaded: true,
                errorMessage: null,
                fetchedAt: action.result.fetchedAt,
            }
        case 'failure':
            return { ...state, isLoading: false, hasLoaded: true, errorMessage: action.message }
        case 'reset':
            return INITIAL_STATE
        case 'disabled':
            return INITIAL_STATE
        default:
            return state
    }
}

export interface WeiboHotRankController {
    state: WeiboHotRankState
    /** 手动刷新：跳过宿主缓存强制回源，未启用时不动 */
    refresh: () => Promise<void>
}

interface UseWeiboHotRankOptions {
    /** 是否具备取数条件：未配置 Cookie 时保持静默 */
    isEnabled: boolean
    /** 榜单来源：侧栏缺省为 band，热搜页按标签传入 */
    tab?: WeiboHotRankTab
    /** 同城榜单的四位城市代码：仅 tab 为 city 时使用 */
    cityCode?: string
}

/** 请求载荷：band 是宿主默认值，不传；city 才需要城市代码 */
function buildPayload(tab: WeiboHotRankTab, cityCode: string, force: boolean): WeiboHotRankRequest {
    return {
        ...(force ? { refresh: true } : {}),
        ...(tab === 'band' ? {} : { tab }),
        ...(tab === 'city' && cityCode.length > 0 ? { cityCode } : {}),
    }
}

/** 热搜控制器：来源或城市变化即重置并重取，已被其它标签占用的旧回包直接丢弃 */
export function useWeiboHotRank({ isEnabled, tab = 'band', cityCode = '' }: UseWeiboHotRankOptions): WeiboHotRankController {
    const [state, dispatch] = useReducer(reducer, INITIAL_STATE)
    // 请求序号与当前 key：切标签或重复点击时，旧回包一律丢弃
    const seqRef = useRef(0)
    const keyRef = useRef('')
    // 已取过的 key：切走再切回沿用现有内容，不重复打同一接口
    const loadedKeyRef = useRef('')

    const load = useCallback(
        async (requestKey: string, force: boolean): Promise<void> => {
            if (!isEnabled) {
                return
            }
            const seq = seqRef.current + 1
            seqRef.current = seq
            dispatch({ type: 'start' })
            try {
                const result = await request<WeiboHotRankResult>(
                    'weibo/hotRank',
                    buildPayload(tab, cityCode, force),
                )
                if (seqRef.current !== seq || keyRef.current !== requestKey) {
                    return
                }
                loadedKeyRef.current = requestKey
                dispatch({ type: 'success', result })
            } catch (cause) {
                if (seqRef.current !== seq || keyRef.current !== requestKey) {
                    return
                }
                dispatch({ type: 'failure', message: toErrorText(cause) })
                toastError(cause)
            }
        },
        [cityCode, isEnabled, tab],
    )

    const refresh = useCallback(async (): Promise<void> => {
        await load(keyRef.current, true)
    }, [load])

    useEffect(() => {
        const requestKey = `${tab}:${cityCode}`
        // 切标签或换城市：先清空旧榜单，避免新数据到达前短暂显示另一张榜
        const isSwitched = keyRef.current !== '' && keyRef.current !== requestKey
        keyRef.current = requestKey
        if (!isEnabled) {
            // 作废在途请求：未配置时不应把上一次的回包再写回状态
            seqRef.current += 1
            loadedKeyRef.current = ''
            dispatch({ type: 'disabled' })
            return
        }
        if (loadedKeyRef.current === requestKey) {
            return
        }
        if (isSwitched) {
            seqRef.current += 1
            dispatch({ type: 'reset' })
        }
        void load(requestKey, false)
    }, [cityCode, isEnabled, load, tab])

    return { state, refresh }
}
