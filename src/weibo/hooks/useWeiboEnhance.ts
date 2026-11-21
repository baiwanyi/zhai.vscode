/**
 * 微博正文 AI 优化：把草稿交给宿主按微博文案口径改写，成功后由调用方回填输入框。
 * 复用约定：协议走 ai/enhancePrompt，payload 带 scene: 'weibo' 选微博口径；
 * 前端兜底超时取宿主上限的两倍，避免前端先于宿主判超时；失败文案走 @shared/utils/error。
 * 关键约束：只回传改写文本，不持有输入框状态；空输入直接回 null，失败也回 null（原文保持不变）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
import { ENHANCE_TIMEOUT_MS } from '@shared/utils/timeouts'

export interface WeiboEnhanceController {
    /** 改写进行中：按钮转圈并禁用发布 */
    isEnhancing: boolean
    /** 请求改写：返回改写后的正文，空输入或失败返回 null */
    enhance: (text: string) => Promise<string | null>
}

/** 微博正文优化控制器：单飞请求，卸载后不再 setState */
export function useWeiboEnhance(): WeiboEnhanceController {
    const [isEnhancing, setIsEnhancing] = useState(false)
    const inFlightRef = useRef(false)
    const isMountedRef = useRef(true)

    useEffect(() => {
        // StrictMode 会先卸载再挂载：每次进入都重置标记，否则回包会被误判为已卸载
        isMountedRef.current = true
        return (): void => {
            isMountedRef.current = false
        }
    }, [])

    const enhance = useCallback(async (text: string): Promise<string | null> => {
        const source = text.trim()
        if (source.length === 0 || inFlightRef.current) {
            return null
        }
        inFlightRef.current = true
        setIsEnhancing(true)
        try {
            const result = await request<{ text: string }>(
                'ai/enhancePrompt',
                { text: source, scene: 'weibo' },
                ENHANCE_TIMEOUT_MS,
            )
            return result.text
        } catch (cause) {
            toastError(cause)
            return null
        } finally {
            inFlightRef.current = false
            if (isMountedRef.current) {
                setIsEnhancing(false)
            }
        }
    }, [])

    return { isEnhancing, enhance }
}
