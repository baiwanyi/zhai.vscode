/**
 * 微博图片地址解析：图床校验 Referer，Webview 直连会被拒，统一经宿主代理换成本地地址。
 * 复用约定：协议走 @shared/utils/bridge 的 request（weibo/image），结果按远程地址做模块级缓存，
 * 同一张图在多处出现（头像、九宫格、表情）只请求一次；超时按图片下载放宽到 25s。
 * 关键约束：缓存 null 表示已确认失败，避免列表反复重试；组件卸载后丢弃回包，
 * 不对已卸载组件 setState。
 */
import { useEffect, useState } from 'react'
import type { WeiboImageResult } from '@shared/types/weibo'
import { WEIBO_METHODS } from '@shared/types/weiboMethods'
import { request } from '@shared/utils/bridge'

/** 图片下载超时：比接口请求宽松，宿主侧单张上限 20s */
const IMAGE_REQUEST_TIMEOUT_MS = 25_000

/** 模块级缓存：null 表示已确认失败 */
const imageUrlCache = new Map<string, string | null>()

/** 图片解析状态：localUrl 非空即可渲染，isFailed 为真时调用方回退占位 */
export interface WeiboImageState {
    localUrl: string | null
    isFailed: boolean
}

/** 读缓存：未命中返回「未失败且未就绪」，由调用方发起请求 */
function readCached(remoteUrl: string): WeiboImageState {
    const cached = imageUrlCache.get(remoteUrl)
    if (cached === undefined) {
        return { localUrl: null, isFailed: false }
    }
    return cached === null ? { localUrl: null, isFailed: true } : { localUrl: cached, isFailed: false }
}

/** 解析单张图片：返回 Webview 可直接加载的本地地址 */
export function useWeiboImage(remoteUrl: string): WeiboImageState {
    const [state, setState] = useState<WeiboImageState>(() => readCached(remoteUrl))

    useEffect(() => {
        // 空地址表示「尚未进入视口」：既不发请求，也不算失败，调用方继续渲染占位
        if (remoteUrl.length === 0) {
            setState({ localUrl: null, isFailed: false })
            return
        }
        const cached = readCached(remoteUrl)
        if (cached.localUrl !== null || cached.isFailed) {
            setState(cached)
            return
        }
        let isCancelled = false
        request<WeiboImageResult>(WEIBO_METHODS.image, { url: remoteUrl }, IMAGE_REQUEST_TIMEOUT_MS)
            .then((result) => {
                if (isCancelled) {
                    return
                }
                imageUrlCache.set(remoteUrl, result.url)
                setState(
                    result.url === null
                        ? { localUrl: null, isFailed: true }
                        : { localUrl: result.url, isFailed: false },
                )
            })
            .catch(() => {
                if (isCancelled) {
                    return
                }
                imageUrlCache.set(remoteUrl, null)
                setState({ localUrl: null, isFailed: true })
            })
        return (): void => {
            isCancelled = true
        }
    }, [remoteUrl])

    return state
}
