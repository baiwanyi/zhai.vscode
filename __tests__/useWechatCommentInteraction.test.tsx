// @vitest-environment jsdom
/**
 * 留言交互的写操作幂等用例：覆盖同帧双击时同步锁只放行一次，以及不同留言互不阻塞。
 * 复用约定：state 以最小替身注入，sentinel hook 用哨兵引用替身接管，与 useWechatFansDetailRace 的时序测试同一手法。
 * 关键约束：锁按「动作类型 + 留言 id」分键，同一条留言的同类操作串行，不同留言的同类操作并行。
 */
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WechatCommentSummary } from '../src/shared/types/wechat'

/** 哨兵引用替身：交互 Hook 只把它透传给列表，不读取 current */
const sentinel: { current: HTMLDivElement | null } = { current: null }

vi.mock('@webview/hooks/useScrollSentinel', () => ({
    useScrollSentinel: (): typeof sentinel => sentinel,
}))

const { useWechatCommentInteraction } = await import('../src/workflow/wechat/comment/hooks/useWechatCommentInteraction')

/** 构造一条最小留言：交互 Hook 只读 id / content / isElected / replyContent */
function makeComment(id: number): WechatCommentSummary {
    return {
        id,
        openid: `openid-${String(id)}`,
        createdAt: '2026-01-01T00:00:00.000Z',
        content: `留言 ${String(id)}`,
        isElected: false,
    }
}

/** 可控 Promise：让写操作停在飞行中，验证第二次点击被锁挡住 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve: ((value: T) => void) | undefined
    const promise = new Promise<T>((r) => {
        resolve = r
    })
    return { promise, resolve: (value: T): void => resolve?.(value) }
}

/** 最小 state 替身：只实现交互 Hook 会读取与调用的字段 */
function makeState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        issues: [],
        selectedIssueId: null,
        selectedSortIndex: 1,
        comments: [],
        total: 0,
        status: 'ready',
        error: null,
        isMutating: false,
        mutatingCommentId: null,
        isLoadingMore: false,
        selectIssue: vi.fn(),
        selectArticle: vi.fn(),
        reload: vi.fn(() => Promise.resolve()),
        loadMore: vi.fn(() => Promise.resolve()),
        reply: vi.fn(() => Promise.resolve(true)),
        mark: vi.fn(() => Promise.resolve(true)),
        remove: vi.fn(() => Promise.resolve(true)),
        openArticle: vi.fn(() => Promise.resolve(true)),
        ...overrides,
    }
}

beforeEach(() => {
    vi.clearAllMocks()
})

describe('useWechatCommentInteraction 写操作幂等', () => {
    it('同一条留言的回复连续提交两次，底层只收到一次请求', async () => {
        const gate = deferred<boolean>()
        const reply = vi.fn(() => gate.promise)
        const state = makeState({ reply })
        const { result } = renderHook(() => useWechatCommentInteraction('测试号', state as never))

        act(() => {
            result.current.actions.onReply(makeComment(1))
            result.current.actions.onReplyChange('内容')
        })
        act(() => {
            result.current.actions.onReplySubmit()
            result.current.actions.onReplySubmit()
        })

        expect(reply).toHaveBeenCalledTimes(1)
        await act(async () => {
            gate.resolve(true)
            await gate.promise
        })
    })

    it('同一条留言的精选与删除分别加锁，互不阻塞', async () => {
        const markGate = deferred<boolean>()
        const removeGate = deferred<boolean>()
        const mark = vi.fn(() => markGate.promise)
        const remove = vi.fn(() => removeGate.promise)
        const state = makeState({ mark, remove })
        const { result } = renderHook(() => useWechatCommentInteraction('测试号', state as never))

        act(() => {
            result.current.actions.onToggleElected(makeComment(2))
            result.current.actions.onToggleElected(makeComment(2))
            result.current.actions.onRequestRemove(makeComment(2))
        })
        // pendingRemove 由 state 承载，必须等它落定后再确认，否则测的是 React 批处理而非幂等锁
        act(() => {
            result.current.actions.onConfirmRemove()
            result.current.actions.onConfirmRemove()
        })

        expect(mark).toHaveBeenCalledTimes(1)
        expect(remove).toHaveBeenCalledTimes(1)
        await act(async () => {
            markGate.resolve(true)
            removeGate.resolve(true)
            await Promise.all([markGate.promise, removeGate.promise])
        })
    })

    it('不同留言的同类操作并行放行', async () => {
        const gate = deferred<boolean>()
        const mark = vi.fn(() => gate.promise)
        const state = makeState({ mark })
        const { result } = renderHook(() => useWechatCommentInteraction('测试号', state as never))

        act(() => {
            result.current.actions.onToggleElected(makeComment(10))
            result.current.actions.onToggleElected(makeComment(11))
        })

        expect(mark).toHaveBeenCalledTimes(2)
        await act(async () => {
            gate.resolve(true)
            await gate.promise
        })
    })

    it('写操作失败后锁释放，可以再次提交', async () => {
        const first = deferred<boolean>()
        const reply = vi
            .fn<() => Promise<boolean>>()
            .mockImplementationOnce(() => first.promise)
            .mockImplementationOnce(() => Promise.resolve(true))
        const state = makeState({ reply })
        const { result } = renderHook(() => useWechatCommentInteraction('测试号', state as never))

        act(() => {
            result.current.actions.onReply(makeComment(3))
            result.current.actions.onReplyChange('第一次')
        })
        act(() => {
            result.current.actions.onReplySubmit()
            result.current.actions.onReplySubmit()
        })
        expect(reply).toHaveBeenCalledTimes(1)

        await act(async () => {
            first.resolve(false)
            await first.promise
        })
        act(() => {
            result.current.actions.onReplySubmit()
        })
        expect(reply).toHaveBeenCalledTimes(2)
    })
})
