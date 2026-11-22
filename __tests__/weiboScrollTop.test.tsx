// @vitest-environment jsdom
/**
 * 回到顶部按钮用例：滚动超过阈值才出现，点击后归零并立即收起。
 * 复用约定：jsdom + renderHook，滚动宿主按 @shared/utils/scrollArea 的标记手工搭一个，
 * scrollTo 用替身接管（jsdom 未实现真正滚动）。
 * 关键约束：监听必须挂在 viewport 上而不是 window，阈值以下不显示按钮。
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useScrollTopVisibility } from '@webview/weibo/hooks/useScrollTopVisibility'
import type { RefObject } from 'react'

afterEach(() => {
    document.body.innerHTML = ''
})

/** 搭一个带 ScrollArea 标记的滚动宿主：scrollTop 可写，scrollTo 用替身 */
function createScrollHost(): {
    root: HTMLDivElement
    viewport: HTMLDivElement
    scrollToMock: ReturnType<typeof vi.fn>
} {
    const root = document.createElement('div')
    const viewport = document.createElement('div')
    viewport.setAttribute('data-slot', 'scroll-area-viewport')
    const scrollToMock = vi.fn()
    Object.defineProperty(viewport, 'scrollTo', { value: scrollToMock, configurable: true })
    Object.defineProperty(viewport, 'scrollTop', { value: 0, writable: true, configurable: true })
    root.appendChild(viewport)
    document.body.appendChild(root)
    return { root, viewport, scrollToMock }
}

describe('useScrollTopVisibility', () => {
    it('滚动超过阈值才显示，点击后归零并收起', () => {
        const { root, viewport, scrollToMock } = createScrollHost()
        const ref: RefObject<HTMLDivElement | null> = { current: root }
        const { result } = renderHook(() => useScrollTopVisibility(ref, 100))

        expect(result.current.isVisible).toBe(false)

        viewport.scrollTop = 60
        act(() => {
            viewport.dispatchEvent(new Event('scroll'))
        })
        expect(result.current.isVisible).toBe(false)

        viewport.scrollTop = 200
        act(() => {
            viewport.dispatchEvent(new Event('scroll'))
        })
        expect(result.current.isVisible).toBe(true)

        act(() => {
            result.current.scrollToTop()
        })
        expect(scrollToMock).toHaveBeenCalledWith({ top: 0 })
        expect(result.current.isVisible).toBe(false)
    })

    it('宿主尚未挂载时不抛错，始终不显示', () => {
        const ref: RefObject<HTMLDivElement | null> = { current: null }
        const { result } = renderHook(() => useScrollTopVisibility(ref))
        expect(result.current.isVisible).toBe(false)
    })
})
