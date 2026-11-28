// @vitest-environment jsdom
/**
 * 留言数据 Loading 收尾用例：覆盖无可查看批次时骨架屏必须退出，以及有批次时正常加载留言。
 * 复用约定：bridge 以替身接管，按方法名分别回投批次与留言列表，和 useWechatFansDetailRace 同一手法。
 * 关键约束：批次为空 / 仅草稿 / 已推送但无文章时，选中与留言 effect 都会提前返回，
 * loadIssues 必须自行把 status 收尾为 ready，否则界面永久停在骨架屏。
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WechatIssueSummary, WechatCommentSummary } from '../src/shared/types/wechat'

/** request 替身：批次与留言分别由用例设定，避免互相干扰 */
const { requestMock } = vi.hoisted(() => ({
    requestMock: vi.fn((method: string): Promise<unknown> => {
        if (method === 'wechat/issues') {
            return Promise.resolve([])
        }
        return Promise.resolve({ comments: [], total: 0 })
    }),
}))

vi.mock('@shared/utils/bridge', () => ({ request: requestMock }))

const { useWechatComments } = await import('../src/workflow/wechat/hooks/useWechatComments')

/** 构造批次：默认已推送且带一篇文章 */
function issue(overrides: Partial<WechatIssueSummary> = {}): WechatIssueSummary {
    return {
        id: 'iss-1',
        title: '批次',
        status: 'published',
        articleCount: 1,
        articles: [{ sortIndex: 1, title: '文章', needOpenComment: true }],
        ...overrides,
    } as WechatIssueSummary
}

/** 构造一条留言 */
function comment(id: number): WechatCommentSummary {
    return {
        id,
        openid: `openid-${String(id)}`,
        createdAt: '2026-01-01T00:00:00.000Z',
        content: `留言 ${String(id)}`,
        isElected: false,
    }
}

beforeEach(() => {
    vi.clearAllMocks()
    requestMock.mockImplementation((method: string): Promise<unknown> => {
        if (method === 'wechat/issues') {
            return Promise.resolve([])
        }
        return Promise.resolve({ comments: [], total: 0 })
    })
})

/** 断言：无论批次为何，status 都必须离开 loading */
async function expectReady(): Promise<void> {
    const { result } = renderHook(() => useWechatComments('acc-1'))
    await waitFor(() => {
        expect(result.current.status).toBe('ready')
    })
    expect(result.current.status).not.toBe('loading')
}

describe('useWechatComments Loading 收尾', () => {
    it('批次列表为空时退出 loading', async () => {
        requestMock.mockImplementation((method: string): Promise<unknown> =>
            method === 'wechat/issues' ? Promise.resolve([]) : Promise.resolve({ comments: [], total: 0 }),
        )
        await expectReady()
    })

    it('只有草稿批次时退出 loading', async () => {
        requestMock.mockImplementation((method: string): Promise<unknown> =>
            method === 'wechat/issues'
                ? Promise.resolve([issue({ status: 'draft' })])
                : Promise.resolve({ comments: [], total: 0 }),
        )
        await expectReady()
    })

    it('已推送但没有文章时退出 loading', async () => {
        requestMock.mockImplementation((method: string): Promise<unknown> =>
            method === 'wechat/issues'
                ? Promise.resolve([issue({ articles: [] })])
                : Promise.resolve({ comments: [], total: 0 }),
        )
        await expectReady()
    })

    it('有可查看批次时选中首篇并加载留言', async () => {
        requestMock.mockImplementation((method: string): Promise<unknown> => {
            if (method === 'wechat/issues') {
                return Promise.resolve([issue()])
            }
            return Promise.resolve({ comments: [comment(1)], total: 1 })
        })

        const { result } = renderHook(() => useWechatComments('acc-1'))
        await waitFor(() => {
            expect(result.current.status).toBe('ready')
            expect(result.current.comments).toHaveLength(1)
        })
        expect(result.current.selectedIssueId).toBe('iss-1')
        expect(result.current.selectedSortIndex).toBe(1)
    })

    it('刷新后当前批次被删除时自动选中仍存在的批次', async () => {
        let issues = [issue({ id: 'iss-old' }), issue({ id: 'iss-new' })]
        requestMock.mockImplementation((method: string): Promise<unknown> => {
            if (method === 'wechat/issues') {
                return Promise.resolve(issues)
            }
            return Promise.resolve({ comments: [], total: 0 })
        })

        const { result } = renderHook(() => useWechatComments('acc-1'))
        await waitFor(() => {
            expect(result.current.selectedIssueId).toBe('iss-old')
        })

        issues = [issue({ id: 'iss-new' })]
        await act(async () => {
            await result.current.reload()
        })
        await waitFor(() => {
            expect(result.current.selectedIssueId).toBe('iss-new')
        })
        expect(result.current.status).not.toBe('error')
    })
})
