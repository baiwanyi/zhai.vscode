// @vitest-environment jsdom
/**
 * 防抖回调用例：覆盖静默期合并、最新闭包、卸载清理与非法延迟兜底。
 * 复用约定：React Hook 用 @testing-library/react 的 renderHook，与 useHostChannelState 的测试同一手法。
 * 关键约束：卸载后不得再执行回调，否则会在已卸载组件上触发 setState；延迟参数异常时按 0 处理而非 NaN。
 */
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDebouncedCallback } from '../src/hooks/useDebouncedCallback'

beforeEach(() => {
    vi.useFakeTimers()
})

describe('useDebouncedCallback', () => {
    it('静默期内的多次调用只执行最后一次', () => {
        const callback = vi.fn()
        const { result } = renderHook(() => useDebouncedCallback(callback, 300))

        act(() => {
            result.current('a')
            result.current('b')
            result.current('c')
        })
        expect(callback).not.toHaveBeenCalled()

        act(() => {
            vi.advanceTimersByTime(299)
        })
        expect(callback).not.toHaveBeenCalled()

        act(() => {
            vi.advanceTimersByTime(1)
        })
        expect(callback).toHaveBeenCalledTimes(1)
        expect(callback).toHaveBeenCalledWith('c')
    })

    it('始终调用最新闭包，不捕获过期回调', () => {
        const first = vi.fn()
        const second = vi.fn()
        const { result, rerender } = renderHook(
            ({ callback: current }) => useDebouncedCallback(current, 100),
            { initialProps: { callback: first } },
        )

        act(() => {
            result.current('x')
        })
        rerender({ callback: second })

        act(() => {
            vi.advanceTimersByTime(100)
        })
        expect(first).not.toHaveBeenCalled()
        expect(second).toHaveBeenCalledWith('x')
    })

    it('卸载后清理在途定时器', () => {
        const callback = vi.fn()
        const { result, unmount } = renderHook(() => useDebouncedCallback(callback, 100))

        act(() => {
            result.current()
        })
        unmount()

        act(() => {
            vi.advanceTimersByTime(200)
        })
        expect(callback).not.toHaveBeenCalled()
    })

    it('非有限延迟按 0 处理，立即执行', () => {
        const callback = vi.fn()
        const { result } = renderHook(() => useDebouncedCallback(callback, Number.NaN))

        act(() => {
            result.current()
            vi.advanceTimersByTime(0)
        })
        expect(callback).toHaveBeenCalledTimes(1)
    })
})
