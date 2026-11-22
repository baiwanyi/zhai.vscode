/**
 * 表情配置取数：打开表情面板时按需触发，一次会话只请求一次。
 * 复用约定：协议走 weibo/emoticons，结果按模块级缓存共享，重复打开面板零网络；
 * 在途请求同样在模块级，多个入口同时打开只发一次；错误文案走 @shared/utils/error。
 * 关键约束：未启用（未配置 Cookie）时不发请求、不置加载中，只保持空列表；
 * 组件卸载后丢弃回包，不对已卸载组件 setState。
 */
import { useCallback, useState } from 'react'
import type { WeiboEmoticonItem, WeiboEmoticonsResult } from '@shared/types/weibo'
import { WEIBO_METHODS } from '@shared/types/weiboMethods'
import { request } from '@shared/utils/bridge'
import { toErrorText, toastError } from '@shared/utils/error'
import { useIsMounted } from '@webview/hooks/useIsMounted'

/** 模块级缓存：表情配置在会话内基本不变，取到后不再请求 */
let cachedEmoticons: WeiboEmoticonItem[] | null = null

/** 在途请求：并发打开面板时共用同一次请求 */
let inFlight: Promise<WeiboEmoticonItem[]> | null = null

export interface WeiboEmoticonsState {
    emoticons: WeiboEmoticonItem[]
    isLoading: boolean
    errorMessage: string | null
}

export interface WeiboEmoticonsController {
    state: WeiboEmoticonsState
    /** 打开面板时调用：已有缓存直接复用，否则发起一次请求 */
    load: () => Promise<void>
}

/** 表情控制器：结果缓存在模块级，页面切换不重复取数 */
export function useWeiboEmoticons(isEnabled: boolean): WeiboEmoticonsController {
    const [state, setState] = useState<WeiboEmoticonsState>(() =>
        cachedEmoticons === null
            ? { emoticons: [], isLoading: false, errorMessage: null }
            : { emoticons: cachedEmoticons, isLoading: false, errorMessage: null },
    )
    const isMountedRef = useIsMounted()

    const load = useCallback(async (): Promise<void> => {
        if (cachedEmoticons !== null) {
            setState({ emoticons: cachedEmoticons, isLoading: false, errorMessage: null })
            return
        }
        if (!isEnabled) {
            return
        }
        setState((previous) => ({ ...previous, isLoading: true, errorMessage: null }))
        inFlight = inFlight ?? request<WeiboEmoticonsResult>(WEIBO_METHODS.emoticons).then((result) => result.emoticons)
        try {
            const emoticons = await inFlight
            cachedEmoticons = emoticons
            if (!isMountedRef.current) {
                return
            }
            setState({ emoticons, isLoading: false, errorMessage: null })
        } catch (cause) {
            if (!isMountedRef.current) {
                return
            }
            setState((previous) => ({ ...previous, isLoading: false, errorMessage: toErrorText(cause) }))
            toastError(cause)
        } finally {
            inFlight = null
        }
    }, [isEnabled])

    return { state, load }
}
