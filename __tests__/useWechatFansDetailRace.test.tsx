// @vitest-environment jsdom
/**
 * 用户详情竞态用例：覆盖连续点选不同用户时迟到响应被丢弃，以及关闭弹窗后过期响应不再回填。
 * 复用约定：bridge 以替身接管，request 的回包时机由用例显式控制，和 useHostChannelState 的时序测试同一手法。
 * 关键约束：只有最新点选的 openid 能写入 detail / detailError，这是避免备注与打标作用于错误用户的核心规则。
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WechatFanDetailResult } from '@shared/types/wechat'

/** request 替身：按方法名返回可控 Promise，详情请求由用例手动 resolve */
const { requestMock } = vi.hoisted(() => ({
    requestMock: vi.fn((method: string): Promise<unknown> => {
        if (method === 'wechat/fans/detail') {
            return new Promise<unknown>(() => undefined)
        }
        return Promise.resolve({ fans: [], tags: [], total: 0, snapshotTotal: 0, task: null })
    }),
}))

vi.mock('@shared/utils/bridge', () => ({ request: requestMock }))

const { useWechatFans } = await import('../src/workflow/wechat/hooks/useWechatFans')

/** 构造详情回包：昵称即 openid，便于断言最终展示的是谁 */
function detailResult(openid: string): WechatFanDetailResult {
    return {
        fan: {
            openid,
            nickname: openid,
            subscribeStatus: 1,
            tagIds: [],
            isBlocked: false,
        },
        related: [],
        province: undefined,
        city: undefined,
        language: undefined,
        subscribeScene: undefined,
    }
}

beforeEach(() => {
    requestMock.mockClear()
})

describe('useWechatFans 详情竞态', () => {
    it('连点两个用户，旧请求迟到时不覆盖新用户的详情', async () => {
        const { result } = renderHook(() => useWechatFans('acc-1'))
        await waitFor(() => {
            expect(result.current.status).toBe('ready')
        })

        let resolveFirst: ((value: WechatFanDetailResult) => void) | undefined
        let resolveSecond: ((value: WechatFanDetailResult) => void) | undefined
        requestMock.mockImplementationOnce((method: string): Promise<unknown> => {
            expect(method).toBe('wechat/fans/detail')
            return new Promise<WechatFanDetailResult>((resolve) => {
                resolveFirst = resolve
            })
        })
        requestMock.mockImplementationOnce((method: string): Promise<unknown> => {
            expect(method).toBe('wechat/fans/detail')
            return new Promise<WechatFanDetailResult>((resolve) => {
                resolveSecond = resolve
            })
        })

        await act(async () => {
            void result.current.openDetail('openid-a')
            void result.current.openDetail('openid-b')
            await Promise.resolve()
        })
        await act(async () => {
            resolveSecond?.(detailResult('openid-b'))
            await Promise.resolve()
        })
        await waitFor(() => {
            expect(result.current.detail?.fan.openid).toBe('openid-b')
        })

        await act(async () => {
            resolveFirst?.(detailResult('openid-a'))
            await Promise.resolve()
        })
        expect(result.current.detail?.fan.openid).toBe('openid-b')
    })

    it('关闭弹窗后，在途详情响应不再回填', async () => {
        const { result } = renderHook(() => useWechatFans('acc-1'))
        await waitFor(() => {
            expect(result.current.status).toBe('ready')
        })

        let resolveDetail: ((value: WechatFanDetailResult) => void) | undefined
        requestMock.mockImplementationOnce((method: string): Promise<unknown> => {
            expect(method).toBe('wechat/fans/detail')
            return new Promise<WechatFanDetailResult>((resolve) => {
                resolveDetail = resolve
            })
        })

        await act(async () => {
            void result.current.openDetail('openid-a')
            await Promise.resolve()
        })
        await act(async () => {
            result.current.closeDetail()
            resolveDetail?.(detailResult('openid-a'))
            await Promise.resolve()
        })
        expect(result.current.detail).toBeNull()
    })
})
