/**
 * 发表框话题搜索：打开话题面板时取常用话题，输入关键字走短去抖后远程搜索。
 * 复用约定：协议走 weibo/topics（q 为空即常用话题），错误文案走 @shared/utils/error，
 * 组件只消费状态与 search 动作，不自行拼请求参数。
 * 关键约束：未配置 Cookie 时不发请求、只保持空列表，也不置加载中；
 * 关键字清空立即回到常用话题，不必等去抖；回包按请求序号校验，先发后到的旧结果直接丢弃；
 * 卸载后不再 setState，去抖计时器在卸载时清理。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { WeiboTopicsResult } from '@shared/types/weibo'
import { WEIBO_METHODS } from '@shared/types/weiboMethods'
import { request } from '@shared/utils/bridge'
import { toErrorText } from '@shared/utils/error'
import { useIsMounted } from '@webview/hooks/useIsMounted'

/** 输入去抖：够用户连打一个词，又不至于让每次按键都打一次接口 */
const SEARCH_DEBOUNCE_MS = 300

/** 话题请求超时：与热搜等元数据接口同一档，超时后前端可重试 */
const TOPIC_REQUEST_TIMEOUT_MS = 15_000

export interface WeiboTopicSearchState {
    topics: string[]
    isLoading: boolean
    errorMessage: string | null
}

export interface WeiboTopicSearchController {
    state: WeiboTopicSearchState
    /** 打开面板时调用：取当前账号的常用话题 */
    loadDefault: () => Promise<void>
    /** 输入关键字：内部去抖，空串立即回到常用话题 */
    search: (query: string) => void
}

const INITIAL_STATE: WeiboTopicSearchState = {
    topics: [],
    isLoading: false,
    errorMessage: null,
}

/** 话题搜索控制器：请求序号保证只有最后一次输入的回包会写回状态 */
export function useWeiboTopicSearch(isEnabled: boolean): WeiboTopicSearchController {
    const [state, setState] = useState<WeiboTopicSearchState>(INITIAL_STATE)
    const seqRef = useRef(0)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const isMountedRef = useIsMounted()

    // 卸载时清掉防抖定时器：标记由 useIsMounted 负责，这里只管还没触发的请求
    useEffect(() => {
        return (): void => {
            if (timerRef.current !== null) {
                clearTimeout(timerRef.current)
                timerRef.current = null
            }
        }
    }, [])

    const load = useCallback(
        async (query: string): Promise<void> => {
            if (!isEnabled) {
                return
            }
            const seq = seqRef.current + 1
            seqRef.current = seq
            setState((previous) => ({ ...previous, isLoading: true, errorMessage: null }))
            try {
                const payload = query.length > 0 ? { q: query } : {}
                const result = await request<WeiboTopicsResult>(WEIBO_METHODS.topics, payload, TOPIC_REQUEST_TIMEOUT_MS)
                if (seqRef.current !== seq || !isMountedRef.current) {
                    return
                }
                setState({ topics: result.topics, isLoading: false, errorMessage: null })
            } catch (cause) {
                if (seqRef.current !== seq || !isMountedRef.current) {
                    return
                }
                // 搜索类面板不弹全局错误：逐字输入时弹窗会连续打断，失败文案留在面板内即可
                setState((previous) => ({ ...previous, isLoading: false, errorMessage: toErrorText(cause) }))
            }
        },
        [isEnabled],
    )

    const loadDefault = useCallback(async (): Promise<void> => {
        await load('')
    }, [load])

    const search = useCallback(
        (query: string): void => {
            if (timerRef.current !== null) {
                clearTimeout(timerRef.current)
                timerRef.current = null
            }
            const keyword = query.trim()
            if (keyword.length === 0) {
                void load('')
                return
            }
            timerRef.current = setTimeout(() => {
                timerRef.current = null
                void load(keyword)
            }, SEARCH_DEBOUNCE_MS)
        },
        [load],
    )

    return { state, loadDefault, search }
}
