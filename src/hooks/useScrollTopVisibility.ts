/**
 * 回到顶部入口的可见性：页面滚动超过阈值才显示按钮，点一下回到列表首屏。
 * 复用约定：滚动宿主从 @shared/utils/scrollArea 的选择器取，回到顶部复用同一个 scrollAreaToTop，
 * 与刷新、切页时的归零动作保持同一份实现。
 * 关键约束：监听挂在 ScrollArea 的 viewport 上（不是 window），卸载必须摘除；
 * 宿主尚未挂载时静默跳过，不兜底到 body；阈值取一屏的一小段，轻微滚动不弹按钮。
 */
import { useCallback, useEffect, useState } from 'react'
import { SCROLL_VIEWPORT_SELECTOR, scrollAreaToTop } from '@shared/utils/scrollArea'
import type { RefObject } from 'react'

/** 触发阈值：滚过一屏的一小段才显示，避免刚滚动就出现 */
const DEFAULT_THRESHOLD = 240

export interface ScrollTopController {
    /** 是否显示「回到顶部」按钮 */
    isVisible: boolean
    /** 回到顶部并立即收起按钮：滚动事件会晚一帧到，先收起避免闪一下 */
    scrollToTop: () => void
}

/**
 * 滚动位置 → 按钮可见性。
 * 关键约束：只在滚动时更新一次布尔值，不记录 scrollTop，避免每帧触发无关重渲染。
 */
export function useScrollTopVisibility(
    rootRef: RefObject<HTMLElement | null>,
    threshold: number = DEFAULT_THRESHOLD,
): ScrollTopController {
    const [isVisible, setIsVisible] = useState(false)

    useEffect(() => {
        const viewport = rootRef.current?.querySelector<HTMLElement>(SCROLL_VIEWPORT_SELECTOR)
        if (viewport === null || viewport === undefined) {
            return
        }
        const update = (): void => {
            setIsVisible(viewport.scrollTop > threshold)
        }
        // 首帧同步一次：切回已滚动过的视图时按钮状态要跟得上
        update()
        viewport.addEventListener('scroll', update, { passive: true })
        return (): void => {
            viewport.removeEventListener('scroll', update)
        }
    }, [rootRef, threshold])

    const scrollToTop = useCallback((): void => {
        scrollAreaToTop(rootRef.current)
        setIsVisible(false)
    }, [rootRef])

    return { isVisible, scrollToTop }
}
