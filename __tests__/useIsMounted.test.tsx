// @vitest-environment jsdom
/**
 * useIsMounted 用例：挂载标记的生命周期。
 * 复用约定：renderHook + StrictMode 包装，覆盖「effect 重跑后仍为 true」这条最容易被写错的分支。
 * 关键约束：只读 ref、不触发重渲染；卸载后恒为 false，调用方据此跳过 setState 与 toast。
 */
import { renderHook } from '@testing-library/react'
import { StrictMode } from 'react'
import { describe, expect, it } from 'vitest'
import { useIsMounted } from '@webview/hooks/useIsMounted'

describe('useIsMounted', () => {
    it('挂载时为 true，卸载后为 false', () => {
        const { result, unmount } = renderHook(() => useIsMounted())
        expect(result.current.current).toBe(true)
        unmount()
        expect(result.current.current).toBe(false)
    })

    it('StrictMode 下 effect 卸载重跑后仍为 true', () => {
        const { result } = renderHook(() => useIsMounted(), {
            wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
        })
        expect(result.current.current).toBe(true)
    })
})
