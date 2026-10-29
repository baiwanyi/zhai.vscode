// @vitest-environment jsdom
/**
 * useImageLibrary 用例：覆盖挂载列举、单张删除后重新列举、批量删除只发一次请求、部分失败提示与请求级失败保列表。
 * 复用约定：渲染用 @testing-library/react 的 renderHook，宿主通信以 bridge.request 替身接管；
 * jsdom 环境由首行指令声明，其余用例仍运行在 node 环境。
 * 关键约束：断言的是「请求次数与回包去向」——删除成功后必须重新列举，前端不做乐观删减；
 * 批量删除只提交一次 media/deleteBatch，逐张结果由回执标记，失败张数汇总成一次提示。
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaDeleteResult, MediaItem, MediaListResult } from '@shared/types/media'
import { useImageLibrary } from '@webview/workflow/imagegen/hooks/useImageLibrary'

const { requestMock, toastErrorMock } = vi.hoisted(() => ({ requestMock: vi.fn(), toastErrorMock: vi.fn() }))

vi.mock('@shared/utils/bridge', () => ({ request: requestMock }))
vi.mock('@shared/utils/error', () => ({ toastError: toastErrorMock }))

const ITEM: MediaItem = {
    id: '20260101010101AbCd12',
    path: 'images/202601/20260101010101AbCd12.png',
    url: 'https://example.test/1.png',
    ext: 'png',
    byteSize: 1024,
    month: '2026-01',
    createdAt: '2026-01-01T00:00:00.000Z',
    scope: 'general',
    origin: 'import',
    kind: 'unknown',
    pressPath: null,
    pressName: null,
    characterId: null,
    characterName: null,
    loreKind: null,
    loreId: null,
    loreName: null,
    usageCount: 0,
    missing: false,
    prompt: null,
    ratio: null,
    style: null,
    enhancedFrom: null,
}

const LIBRARY: MediaListResult = { items: [ITEM], months: [{ month: '2026-01', count: 1 }], total: 1 }
const EMPTY_LIBRARY: MediaListResult = { items: [], months: [], total: 0 }

/** 删除回执：默认无引用、无封面回退 */
function deleteResult(overrides: Partial<MediaDeleteResult> = {}): MediaDeleteResult {
    return {
        removed: true,
        usages: [],
        coverSelectedId: null,
        characterCoverFallbacks: {},
        loreCoverFallbacks: {},
        ...overrides,
    }
}

beforeEach(() => {
    requestMock.mockReset()
    toastErrorMock.mockReset()
})

describe('useImageLibrary', () => {
    it('挂载时列举一次并写入状态', async () => {
        requestMock.mockResolvedValueOnce(LIBRARY)

        const { result } = renderHook(() => useImageLibrary())

        await waitFor(() => expect(result.current.isLoading).toBe(false))
        expect(requestMock).toHaveBeenCalledWith('media/list', {})
        expect(result.current.items).toHaveLength(1)
        expect(result.current.months).toEqual([{ month: '2026-01', count: 1 }])
    })

    it('单张删除后重新列举，并回传删除回执', async () => {
        requestMock.mockResolvedValueOnce(LIBRARY)
        const { result } = renderHook(() => useImageLibrary())
        await waitFor(() => expect(result.current.isLoading).toBe(false))
        requestMock.mockClear()
        requestMock.mockResolvedValueOnce(deleteResult()).mockResolvedValueOnce(EMPTY_LIBRARY)

        let outcome: MediaDeleteResult | null = null
        await act(async () => {
            outcome = await result.current.removeMedia(ITEM)
        })

        expect(requestMock).toHaveBeenNthCalledWith(1, 'media/delete', { id: ITEM.id })
        expect(requestMock).toHaveBeenNthCalledWith(2, 'media/list', {})
        expect(outcome).not.toBeNull()
        expect(result.current.items).toHaveLength(0)
    })

    it('批量删除只发一次 deleteBatch，逐张结果按 id 对回原条目', async () => {
        requestMock.mockResolvedValueOnce(LIBRARY)
        const { result } = renderHook(() => useImageLibrary())
        await waitFor(() => expect(result.current.isLoading).toBe(false))
        requestMock.mockClear()
        requestMock
            .mockResolvedValueOnce({ removals: [{ id: ITEM.id, removed: true }], months: [], total: 0 })
            .mockResolvedValueOnce(EMPTY_LIBRARY)

        // 用对象承载结果：闭包里赋值的局部变量在闭包外会被控制流收窄成 null
        const batch: { value: Awaited<ReturnType<typeof result.current.removeMedias>> | null } = { value: null }
        await act(async () => {
            batch.value = await result.current.removeMedias([ITEM])
        })

        const deleteCalls = requestMock.mock.calls.filter((call) => call[0] === 'media/deleteBatch')
        expect(deleteCalls).toHaveLength(1)
        expect(deleteCalls[0]?.[1]).toEqual({ ids: [ITEM.id] })
        expect(batch.value?.removals).toEqual([{ item: ITEM, removed: true }])
    })

    it('部分失败时汇总提示一次，成功的那张仍标记为已删除', async () => {
        const SECOND: MediaItem = { ...ITEM, id: '20260101010102EfGh34', path: 'images/202601/20260101010102EfGh34.png' }
        requestMock.mockResolvedValueOnce(LIBRARY)
        const { result } = renderHook(() => useImageLibrary())
        await waitFor(() => expect(result.current.isLoading).toBe(false))
        requestMock.mockClear()
        requestMock
            .mockResolvedValueOnce({
                removals: [
                    { id: ITEM.id, removed: true },
                    { id: SECOND.id, removed: false },
                ],
                months: [],
                total: 0,
            })
            .mockResolvedValueOnce(EMPTY_LIBRARY)

        const batch: { value: Awaited<ReturnType<typeof result.current.removeMedias>> | null } = { value: null }
        await act(async () => {
            batch.value = await result.current.removeMedias([ITEM, SECOND])
        })

        expect(toastErrorMock).toHaveBeenCalledTimes(1)
        expect(batch.value?.removals.map((item) => item.removed)).toEqual([true, false])
    })

    it('批量删除请求级失败时保留原列表并提示', async () => {
        requestMock.mockResolvedValueOnce(LIBRARY)
        const { result } = renderHook(() => useImageLibrary())
        await waitFor(() => expect(result.current.isLoading).toBe(false))
        requestMock.mockClear()
        requestMock.mockRejectedValueOnce(new Error('删除失败'))

        const batch: { value: Awaited<ReturnType<typeof result.current.removeMedias>> | null } = { value: null }
        await act(async () => {
            batch.value = await result.current.removeMedias([ITEM])
        })

        expect(toastErrorMock).toHaveBeenCalledTimes(1)
        expect(batch.value?.removals).toHaveLength(0)
        expect(result.current.items).toHaveLength(1)
    })

    it('静默刷新只换数据，不切加载态', async () => {
        requestMock.mockResolvedValueOnce(LIBRARY)
        const { result } = renderHook(() => useImageLibrary())
        await waitFor(() => expect(result.current.isLoading).toBe(false))
        requestMock.mockResolvedValueOnce(EMPTY_LIBRARY)

        await act(async () => {
            await result.current.reload({ silent: true })
        })

        expect(result.current.isLoading).toBe(false)
        expect(result.current.items).toHaveLength(0)
    })
})
