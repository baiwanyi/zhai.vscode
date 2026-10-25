// @vitest-environment jsdom
/**
 * useImageDetail 用例：覆盖空路径不发请求、正常读取、切图后迟到回包被丢弃与失败落到空态。
 * 复用约定：渲染用 renderHook，bridge.request 以替身接管，回包顺序用显式 resolve 控制；
 * jsdom 环境由首行指令声明。
 * 关键约束：迟到回包必须按来源路径丢弃，否则详情面板会显示上一张图的参数；
 * 读取失败也要结束 loading，不能停在骨架屏。
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImageDetailResult } from '@shared/types/imagegen'
import { useImageDetail } from '@webview/workflow/imagegen/useImageDetail'

const { requestMock, toastErrorMock } = vi.hoisted(() => ({ requestMock: vi.fn(), toastErrorMock: vi.fn() }))

vi.mock('@shared/utils/bridge', () => ({ request: requestMock }))
vi.mock('@shared/utils/error', () => ({ toastError: toastErrorMock }))

const DIR_PATH = 'press/剑来'
const PATH_A = 'press/剑来/Images/photo-20260101010101-AbCd1234.png'
const PATH_B = 'press/剑来/Images/photo-20270101010101-AbCd1234.png'

/** 造一份侧车结果：只有 prompt 与比例不同，便于区分来源 */
function detailOf(prompt: string): ImageDetailResult {
    return {
        prompt,
        ratio: '3:4',
        style: 'auto',
        characterId: null,
        enhancedFrom: null,
        createdAt: '2026-01-01T00:00:00.000Z',
    }
}

beforeEach(() => {
    requestMock.mockReset()
    toastErrorMock.mockReset()
})

describe('useImageDetail', () => {
    it('路径为 null 时不发请求，也不进入加载态', () => {
        const { result } = renderHook(() => useImageDetail(DIR_PATH, null))

        expect(requestMock).not.toHaveBeenCalled()
        expect(result.current).toEqual({ detail: null, isLoading: false })
    })

    it('读取成功后给出详情并结束加载态', async () => {
        requestMock.mockResolvedValueOnce(detailOf('雪夜'))

        const { result } = renderHook(() => useImageDetail(DIR_PATH, PATH_A))

        expect(result.current.isLoading).toBe(true)
        await waitFor(() => expect(result.current.isLoading).toBe(false))
        expect(result.current.detail?.prompt).toBe('雪夜')
        expect(requestMock).toHaveBeenCalledWith('pressAi/getImageDetail', { dirPath: DIR_PATH, path: PATH_A })
    })

    it('切图后迟到的旧回包被丢弃，不覆盖当前详情', async () => {
        // 第一张的请求故意慢一拍，模拟切图后旧回包迟到
        requestMock.mockImplementation((_method: string, params: { path: string }) =>
            params.path === PATH_A
                ? new Promise<ImageDetailResult>((resolve) => {
                      setTimeout(() => resolve(detailOf('第一张')), 30)
                  })
                : Promise.resolve(detailOf('第二张')),
        )

        const { result, rerender } = renderHook(({ path }) => useImageDetail(DIR_PATH, path), {
            initialProps: { path: PATH_A },
        })
        rerender({ path: PATH_B })
        await waitFor(() => expect(result.current.detail?.prompt).toBe('第二张'))

        // 等旧回包抵达后再断言：期间不得把详情改回第一张
        await act(async () => {
            await new Promise((resolve) => {
                setTimeout(resolve, 60)
            })
        })

        expect(result.current.detail?.prompt).toBe('第二张')
    })

    it('读取失败时结束加载态并提示，详情为 null', async () => {
        requestMock.mockRejectedValueOnce(new Error('侧车读取失败'))

        const { result } = renderHook(() => useImageDetail(DIR_PATH, PATH_A))

        await waitFor(() => expect(result.current.isLoading).toBe(false))
        expect(result.current.detail).toBeNull()
        expect(toastErrorMock).toHaveBeenCalledTimes(1)
    })
})
