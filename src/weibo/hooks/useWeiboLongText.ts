/**
 * 长文全文补全：单条目标的取全文状态机（在飞占位、失败留重试、空文本不覆盖摘要、卸载后不回写）。
 * 复用约定：主贴与转发体各调一次，id 按各自可用标识给（主贴 mblogid 优先，转发体用数字 id）；
 * 请求走 weibo/longtext，错误提示交 @shared/utils/error，自动补全失败只落重试入口。
 * 关键约束：同一目标只允许一条在飞；进入视口才自动取，避免一屏几十条同时打接口被上游限流；
 * 空文本等同失败——直接采用会把摘要清成「（无正文）」，故仅在非空时替换。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { WeiboLongTextResult } from '@shared/types/weibo'
import { WEIBO_METHODS } from '@shared/types/weiboMethods'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
import { useIsMounted } from '@webview/hooks/useIsMounted'

/** 取全文超时：与宿主侧 20s 口径一致 */
const LONG_TEXT_TIMEOUT_MS = 20_000

/** 长文控制器：卡片把 fullText / 状态交给折叠区与卡片动作共用 */
export interface WeiboLongTextController {
    /** 已取到的全文：null 表示仍是摘要 */
    fullText: string | null
    /** 请求进行中 */
    isLoading: boolean
    /** 最近一次请求失败：只留重试入口，不再自动重试避免刷接口 */
    hasFailed: boolean
    /** 手动或自动取全文：isManual 为真时失败会弹提示 */
    requestFullText: (isManual?: boolean) => void
}

/**
 * 单条微博的长文全文。
 * @param id 长文接口入参：主贴用 mblogid 优先，转发体用数字 id
 * @param isLongText 上游声明为长文：false 时永不自动请求
 * @param isVisible 正文是否已进入视口：进入后才自动取
 */
export function useWeiboLongText(id: string, isLongText: boolean, isVisible: boolean): WeiboLongTextController {
    const [fullText, setFullText] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    const [hasFailed, setHasFailed] = useState(false)
    /** 在飞占位：ref 判定，避开闭包读到旧 state 与严格模式下的双次 effect */
    const inFlightRef = useRef(false)
    /** 卸载标记：列表刷新会整块替换卡片，回包到货时组件可能已卸载，不再写状态 */
    const isMountedRef = useIsMounted()

    const requestFullText = useCallback(
        (isManual = false): void => {
            if (inFlightRef.current || id.length === 0) {
                return
            }
            inFlightRef.current = true
            setIsLoading(true)
            void request<WeiboLongTextResult>(WEIBO_METHODS.longText, { id }, LONG_TEXT_TIMEOUT_MS)
                .then((result) => {
                    if (isMountedRef.current && result.text.length > 0) {
                        setFullText(result.text)
                    }
                })
                .catch((cause: unknown) => {
                    if (!isMountedRef.current) {
                        return
                    }
                    setHasFailed(true)
                    if (isManual) {
                        toastError(cause)
                    }
                })
                .finally(() => {
                    inFlightRef.current = false
                    if (isMountedRef.current) {
                        setIsLoading(false)
                    }
                })
        },
        [id],
    )

    /** 自动补全：进入视口且仍是摘要、未失败时才发起，失败后不再自动重试 */
    useEffect(() => {
        if (!isLongText || fullText !== null || hasFailed || !isVisible) {
            return
        }
        requestFullText()
    }, [fullText, hasFailed, isLongText, isVisible, requestFullText])

    return { fullText, isLoading, hasFailed, requestFullText }
}
