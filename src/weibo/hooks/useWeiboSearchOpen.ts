/**
 * 热搜打开动作：拼搜索页地址，并以 300ms 窗口拦住连点，避免一次双击打开两个浏览器标签。
 * 复用约定：地址构造来自 weibo/utils/weiboLinks，打开动作统一走宿主 weibo/openPost，
 * 失败文案交 @shared/utils/error；调用方只消费 searchUrl 与 openSearch。
 * 关键约束：节流时刻放 ref，同一行的连续点击只放行第一次；
 * 请求失败只提示、不改行状态（榜单内容与打开动作互不影响）。
 */
import { useCallback, useRef } from 'react'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
import { buildHotSearchUrl } from '../utils/weiboLinks'

/** 连点保护窗口：窗口内的重复点击直接忽略 */
const OPEN_THROTTLE_MS = 300

export interface WeiboSearchOpenController {
    /** 搜索页地址：同时供标题 `<a href>` 与右键复制使用 */
    searchUrl: string
    /** 打开搜索页：走宿主 weibo/openPost，窗口内的重复点击被忽略 */
    openSearch: () => void
}

export function useWeiboSearchOpen(title: string): WeiboSearchOpenController {
    const searchUrl = buildHotSearchUrl(title)
    // 上次打开时刻：连点只放行第一次
    const lastOpenAtRef = useRef(0)

    const openSearch = useCallback((): void => {
        const now = Date.now()
        if (now - lastOpenAtRef.current < OPEN_THROTTLE_MS) {
            return
        }
        lastOpenAtRef.current = now
        void request('weibo/openPost', { url: searchUrl }).catch(toastError)
    }, [searchUrl])

    return { searchUrl, openSearch }
}
