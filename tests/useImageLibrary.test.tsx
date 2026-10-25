// @vitest-environment jsdom
/**
 * useImageLibrary 用例：覆盖挂载列举、批量删除只发一次请求、部分失败逐张标记、请求级失败保留列表与静默刷新。
 * 复用约定：渲染用 @testing-library/react 的 renderHook，宿主通信以 bridge.request 替身接管；
 * jsdom 环境由首行指令声明，其余用例仍运行在 node 环境。
 * 关键约束：断言的是「请求次数与回包去向」——批量删除后状态必须直接采用回传的 library，
 * 不允许再发一次列举请求；silent 刷新只换数据不切加载态，否则迟到落盘会让用户眼前列表闪一下。
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImageLibraryResult, PressImageItem } from '@shared/types/imagegen'
import { useImageLibrary } from '@webview/workflow/imagegen/hooks/useImageLibrary'

const { requestMock, toastErrorMock } = vi.hoisted(() => ({ requestMock: vi.fn(), toastErrorMock: vi.fn() }))

vi.mock('@shared/utils/bridge', () => ({ request: requestMock }))
vi.mock('@shared/utils/error', () => ({ toastError: toastErrorMock }))

const DIR_PATH = 'press/剑来'
const IMAGE: PressImageItem = {
    id: 'photo-20260101010101-AbCd1234',
    kind: 'photo',
    path: 'press/剑来/Images/photo-20260101010101-AbCd1234.png',
    url: 'https://example.test/1.png',
    createdAt: '2026-01-01T00:00:00.000Z',
    characterId: null,
}
const LIBRARY: ImageLibraryResult = {
    images: [IMAGE],
    coverSelectedId: null,
    counts: { portrait: 0, photo: 1, orphan: 0 },
}
const EMPTY_LIBRARY: ImageLibraryResult = {
    images: [],
    coverSelectedId: null,
    counts: { portrait: 0, photo: 0, orphan: 0 },
}

beforeEach(() => {
    requestMock.mockReset()
    toastErrorMock.mockReset()
})

describe('useImageLibrary', () => {
    it('挂载时列举一次并写入状态', async () => {
        requestMock.mockResolvedValueOnce(LIBRARY)

        const { result } = renderHook(() => useImageLibrary(DIR_PATH))

        await waitFor(() => expect(result.current.isLoading).toBe(false))
        expect(requestMock).toHaveBeenCalledWith('pressAi/listImageLibrary', { dirPath: DIR_PATH })
        expect(result.current.images).toHaveLength(1)
    })

    it('批量删除只发一次 deleteImages，并用回传的 library 更新状态', async () => {
        requestMock.mockResolvedValueOnce(LIBRARY)
        const { result } = renderHook(() => useImageLibrary(DIR_PATH))
        await waitFor(() => expect(result.current.isLoading).toBe(false))
        requestMock.mockClear()
        requestMock.mockResolvedValueOnce({
            removals: [{ path: IMAGE.path, removed: true }],
            library: EMPTY_LIBRARY,
        })

        let batch: Awaited<ReturnType<typeof result.current.removeImages>> | null = null
        await act(async () => {
            batch = await result.current.removeImages([IMAGE])
        })

        expect(requestMock).toHaveBeenCalledTimes(1)
        expect(requestMock).toHaveBeenCalledWith('pressAi/deleteImages', { dirPath: DIR_PATH, paths: [IMAGE.path] })
        expect(batch).toEqual({ removals: [{ image: IMAGE, removed: true }], images: [] })
        expect(result.current.images).toHaveLength(0)
    })

    it('部分失败时逐张标记并汇总提示', async () => {
        requestMock.mockResolvedValueOnce(LIBRARY)
        const { result } = renderHook(() => useImageLibrary(DIR_PATH))
        await waitFor(() => expect(result.current.isLoading).toBe(false))
        requestMock.mockClear()
        requestMock.mockResolvedValueOnce({
            removals: [{ path: IMAGE.path, removed: false }],
            library: LIBRARY,
        })

        let batch: Awaited<ReturnType<typeof result.current.removeImages>> | null = null
        await act(async () => {
            batch = await result.current.removeImages([IMAGE])
        })

        expect(batch).toEqual({ removals: [{ image: IMAGE, removed: false }], images: [IMAGE] })
        expect(toastErrorMock).toHaveBeenCalledTimes(1)
    })

    it('请求级失败时返回空回执并保留原列表', async () => {
        requestMock.mockResolvedValueOnce(LIBRARY)
        const { result } = renderHook(() => useImageLibrary(DIR_PATH))
        await waitFor(() => expect(result.current.isLoading).toBe(false))
        requestMock.mockClear()
        requestMock.mockRejectedValueOnce(new Error('网络中断'))

        let batch: Awaited<ReturnType<typeof result.current.removeImages>> | null = null
        await act(async () => {
            batch = await result.current.removeImages([IMAGE])
        })

        expect(batch).toEqual({ removals: [], images: [IMAGE] })
        expect(result.current.images).toHaveLength(1)
        expect(toastErrorMock).toHaveBeenCalledTimes(1)
    })

    it('静默刷新只换数据，不切回加载态', async () => {
        requestMock.mockResolvedValueOnce(LIBRARY)
        const { result } = renderHook(() => useImageLibrary(DIR_PATH))
        await waitFor(() => expect(result.current.isLoading).toBe(false))
        requestMock.mockClear()
        requestMock.mockResolvedValueOnce(EMPTY_LIBRARY)

        let pending: Promise<void> = Promise.resolve()
        act(() => {
            pending = result.current.reload({ silent: true })
        })
        // 请求未回包期间列表照常可读，不出现「正在读取图片」
        expect(result.current.isLoading).toBe(false)
        await act(async () => {
            await pending
        })

        expect(requestMock).toHaveBeenCalledTimes(1)
        expect(requestMock).toHaveBeenCalledWith('pressAi/listImageLibrary', { dirPath: DIR_PATH })
        expect(result.current.images).toHaveLength(0)
        expect(result.current.isLoading).toBe(false)
    })
})
