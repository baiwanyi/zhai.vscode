// @vitest-environment jsdom
/**
 * useHostChannelState 用例：覆盖快照回填、广播优先、畸形载荷与异通道丢弃、卸载解除订阅、重渲染不重复订阅。
 * 复用约定：bridge 以替身接管，onState 的订阅者由用例集中持有，request 的回包时机由用例显式控制。
 * 关键约束：后到的快照不得覆盖已到达的广播，这是一致性的核心规则，调整实现时必须保住；
 * 参数对象每次渲染新建，但订阅只应发生一次，靠的是依赖收敛到标量。
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StateMessage } from '@shared/types/messages'
import { useHostChannelState } from '@webview/hooks/useHostChannelState'

const { requestMock, listeners } = vi.hoisted(() => ({
    requestMock: vi.fn(),
    listeners: new Set<(message: StateMessage) => void>(),
}))

vi.mock('@shared/utils/bridge', () => ({
    request: requestMock,
    onState: (listener: (message: StateMessage) => void): (() => void) => {
        listeners.add(listener)
        return (): void => {
            listeners.delete(listener)
        }
    },
}))

interface Snapshot {
    path: string
}

/** 被测载荷的形态守卫：路径必须为字符串 */
function isSnapshot(payload: unknown): payload is Snapshot {
    return typeof payload === 'object' && payload !== null && typeof (payload as { path?: unknown }).path === 'string'
}

const INITIAL: Snapshot = { path: 'press/初始' }

/** 固定参数：通道、方法名与守卫都与用例无关，便于聚焦回包时序 */
const OPTIONS = { method: 'press/active', channel: 'press', isValid: isSnapshot, initial: INITIAL } as const

/** 等价判定：只比较路径，模拟「广播内容没变」的场景 */
function isSamePath(previous: Snapshot, next: Snapshot): boolean {
    return previous.path === next.path
}

/** 构造一次状态广播 */
function stateMessage(channel: StateMessage['channel'], payload: unknown): StateMessage {
    return { type: 'state', channel, payload }
}

/** 向当前全部订阅者派发广播 */
function broadcast(message: StateMessage): void {
    for (const listener of listeners) {
        listener(message)
    }
}

beforeEach(() => {
    requestMock.mockReset()
    listeners.clear()
})

describe('useHostChannelState', () => {
    it('挂载后拉取快照并落到状态', async () => {
        requestMock.mockResolvedValue({ path: 'press/剑来' })
        const { result } = renderHook(() => useHostChannelState<Snapshot>({ ...OPTIONS }))
        await waitFor(() => {
            expect(result.current.path).toBe('press/剑来')
        })
    })

    it('广播先到后，迟到的快照不得覆盖', async () => {
        let resolveSnapshot: (value: unknown) => void = () => undefined
        requestMock.mockReturnValue(
            new Promise<unknown>((resolve) => {
                resolveSnapshot = resolve
            }),
        )
        const { result } = renderHook(() => useHostChannelState<Snapshot>({ ...OPTIONS }))
        act(() => {
            broadcast(stateMessage('press', { path: 'press/广播' }))
        })
        expect(result.current.path).toBe('press/广播')
        await act(async () => {
            resolveSnapshot({ path: 'press/旧快照' })
            await Promise.resolve()
        })
        expect(result.current.path).toBe('press/广播')
    })

    it('畸形载荷与其它通道的广播一律丢弃', () => {
        requestMock.mockResolvedValue(INITIAL)
        const { result } = renderHook(() => useHostChannelState<Snapshot>({ ...OPTIONS }))
        act(() => {
            broadcast(stateMessage('press', { path: 42 }))
            broadcast(stateMessage('note', { path: 'press/笔记通道' }))
        })
        expect(result.current.path).toBe('press/初始')
    })

    it('等价载荷复用原引用，跳过状态更新', async () => {
        requestMock.mockResolvedValue({ path: 'press/剑来' })
        const { result } = renderHook(() => useHostChannelState<Snapshot>({ ...OPTIONS, isEqual: isSamePath }))
        await waitFor(() => {
            expect(result.current.path).toBe('press/剑来')
        })
        const settled = result.current
        act(() => {
            broadcast(stateMessage('press', { path: 'press/剑来' }))
        })
        // 引用被复用说明等价判定生效；否则每次广播都会塞入一个新对象
        expect(result.current).toBe(settled)
    })

    it('重渲染不会重复订阅', () => {
        requestMock.mockResolvedValue(INITIAL)
        const { rerender } = renderHook(() => useHostChannelState<Snapshot>({ ...OPTIONS }))
        expect(listeners.size).toBe(1)
        rerender()
        expect(listeners.size).toBe(1)
    })

    it('卸载后解除订阅', () => {
        requestMock.mockResolvedValue(INITIAL)
        const { unmount } = renderHook(() => useHostChannelState<Snapshot>({ ...OPTIONS }))
        expect(listeners.size).toBe(1)
        unmount()
        expect(listeners.size).toBe(0)
    })
})
