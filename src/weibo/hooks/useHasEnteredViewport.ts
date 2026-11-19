/**
 * 视口判定：元素第一次进入可视区域附近后返回 true，作为「可以开始下载」的开关。
 * 复用约定：配图、头像、表情共用本 hook，占位节点挂 ref 即可；进入后不再监听。
 * 关键约束：ref 必须挂在首次渲染的占位节点上，否则图片一进列表就会全部发起请求；
 * 提前一屏（240px）开始取图，滚到位时基本已就绪。
 */
import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

/** 预取提前量：视口外一屏内也开始加载 */
const ROOT_MARGIN = '240px'

export function useHasEnteredViewport(): { ref: RefObject<HTMLSpanElement | null>; hasEntered: boolean } {
    const ref = useRef<HTMLSpanElement | null>(null)
    const [hasEntered, setHasEntered] = useState(false)

    useEffect(() => {
        if (hasEntered) {
            return
        }
        const node = ref.current
        if (node === null) {
            return
        }
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    setHasEntered(true)
                    observer.disconnect()
                }
            },
            { rootMargin: ROOT_MARGIN },
        )
        observer.observe(node)
        return (): void => {
            observer.disconnect()
        }
    }, [hasEntered])

    return { ref, hasEntered }
}
