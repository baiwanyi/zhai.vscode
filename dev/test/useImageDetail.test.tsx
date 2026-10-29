// @vitest-environment jsdom
/**
 * useImageDetail 用例：覆盖空 id 不发请求、正常读取、切图后迟到回包被丢弃与失败落到空态。
 * 复用约定：渲染用 renderHook，bridge.request 以替身接管，回包顺序用显式 resolve 控制；
 * jsdom 环境由首行指令声明。
 * 关键约束：迟到回包必须按来源 id 丢弃，否则详情面板会显示上一张图的参数；
 * 读取失败也要结束 loading，不能停在骨架屏。
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaDetailResult, MediaItem } from '@shared/types/media'
import { useImageDetail } from '@webview/workflow/imagegen/hooks/useImageDetail'

const { requestMock, toastErrorMock } = vi.hoisted(() => ({ requestMock: vi.fn(), toastErrorMock: vi.fn() }))

vi.mock('@shared/utils/bridge', () => ({ request: requestMock }))
vi.mock('@shared/utils/error', () => ({ toastError: toastErrorMock }))

const ID_A = '20260101010101AbCd12'
const ID_B = '20270101010101AbCd34'

/** 造一份媒体条目：只有提示词不同，便于区分来源 */
function itemOf(prompt: string): MediaItem {
    return {
        id: prompt === '第一张' ? ID_A : ID_B,
        path: `images/202601/${prompt === '第一张' ? ID_A : ID_B}.png`,
        url: 'https://example.test/media.png',
        ext: 'png',
        byteSize: 1024,
        month: '2026-01',
        createdAt: '2026-01-01T00:00:00.000Z',
        scope: 'press',
        origin: 'generate',
        kind: 'photo',
        pressPath: 'press/剑来',
        pressName: '剑来',
        characterId: null,
        characterName: null,
        loreKind: null,
        loreId: null,
        loreName: null,
        usageCount: 0,
        missing: false,
        prompt,
        ratio: '3:4',
        style: 'auto',
        enhancedFrom: null,
    }
}

/** 详情回包：条目 + 引用，引用为空不影响本轮断言 */
function detailOf(prompt: string): MediaDetailResult {
    return { item: itemOf(prompt), usages: [] }
}

beforeEach(() => {
    requestMock.mockReset()
    toastErrorMock.mockReset()
})

describe('useImageDetail', () => {
    it('id 为 null 时不发请求，也不进入加载态', () => {
        const { result } = renderHook(() => useImageDetail(null))

        expect(requestMock).not.toHaveBeenCalled()
        expect(result.current).toEqual({ detail: null, isLoading: false })
    })

    it('读取成功后给出详情并结束加载态', async () => {
        requestMock.mockResolvedValueOnce(detailOf('第一张'))

        const { result } = renderHook(() => useImageDetail(ID_A))

        expect(result.current.isLoading).toBe(true)
        await waitFor(() => expect(result.current.isLoading).toBe(false))
        expect(result.current.detail?.item.prompt).toBe('第一张')
        expect(requestMock).toHaveBeenCalledWith('media/detail', { id: ID_A })
    })

    it('切图后迟到的旧回包被丢弃，不覆盖当前详情', async () => {
        // 第一张的请求故意慢一拍，模拟切图后旧回包迟到
        requestMock.mockImplementation((_method: string, params: { id: string }) =>
            params.id === ID_A
                ? new Promise<MediaDetailResult>((resolve) => {
                      setTimeout(() => resolve(detailOf('第一张')), 30)
                  })
                : Promise.resolve(detailOf('第二张')),
        )

        const { result, rerender } = renderHook(({ id }) => useImageDetail(id), {
            initialProps: { id: ID_A },
        })
        rerender({ id: ID_B })
        await waitFor(() => expect(result.current.detail?.item.prompt).toBe('第二张'))

        // 等旧回包抵达后再断言：期间不得把详情改回第一张
        await act(async () => {
            await new Promise((resolve) => {
                setTimeout(resolve, 60)
            })
        })

        expect(result.current.detail?.item.prompt).toBe('第二张')
    })

    it('读取失败时结束加载态并提示，详情为 null', async () => {
        requestMock.mockRejectedValueOnce(new Error('图片不存在或已被删除'))

        const { result } = renderHook(() => useImageDetail(ID_A))

        await waitFor(() => expect(result.current.isLoading).toBe(false))
        expect(result.current.detail).toBeNull()
        expect(toastErrorMock).toHaveBeenCalledTimes(1)
    })
})
