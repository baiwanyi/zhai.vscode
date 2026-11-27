// @vitest-environment jsdom
/**
 * 用户同步 Hook 用例：覆盖成功回传任务、失败上抛、按最近任务自动续跑三种路径。
 * 复用约定：bridge 以替身接管，返回形状按 shared/types/wechat 的 WechatFanSyncResult 构造。
 * 关键约束：sync() 不接收 taskId，续跑与否由 hook 依最近任务状态判定，用例从 request 的 payload 断言该决策。
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WechatFanSyncTask } from '@shared/types/wechat'

/** 构造任务：状态与 id 由用例指定，其余字段固定便于断言 */
function makeTask(id: string, status: WechatFanSyncTask['status']): WechatFanSyncTask {
    return {
        id,
        status,
        cursor: 'next',
        pageCount: 5,
        fetched: 120,
        total: 250,
        createdCount: 120,
        updatedCount: 0,
        unfollowed: 0,
        failedCount: 0,
        startedAt: '2026-11-27T10:00:00.000Z',
    }
}

const { requestMock } = vi.hoisted(() => ({
    requestMock: vi.fn((method: string, payload?: unknown): Promise<unknown> => {
        void payload
        if (method === 'wechat/fans/sync') {
            return Promise.resolve({
                task: {
                    id: 'task-1',
                    status: 'partial',
                    cursor: 'next',
                    pageCount: 5,
                    fetched: 120,
                    total: 250,
                    createdCount: 120,
                    updatedCount: 0,
                    unfollowed: 0,
                    failedCount: 0,
                    startedAt: '2026-11-27T10:00:00.000Z',
                } satisfies WechatFanSyncTask,
            })
        }
        return Promise.resolve({ fans: [], tags: [], total: 0, snapshotTotal: 0, task: null })
    }),
}))

vi.mock('@shared/utils/bridge', () => ({ request: requestMock }))

const { useWechatFans } = await import('../src/workflow/wechat/hooks/useWechatFans')

beforeEach(() => {
    requestMock.mockClear()
    requestMock.mockImplementation((method: string): Promise<unknown> => {
        if (method === 'wechat/fans/sync') {
            return Promise.resolve({
                task: {
                    id: 'task-1',
                    status: 'partial',
                    cursor: 'next',
                    pageCount: 5,
                    fetched: 120,
                    total: 250,
                    createdCount: 120,
                    updatedCount: 0,
                    unfollowed: 0,
                    failedCount: 0,
                    startedAt: '2026-11-27T10:00:00.000Z',
                } satisfies WechatFanSyncTask,
            })
        }
        return Promise.resolve({ fans: [], tags: [], total: 0, snapshotTotal: 0, task: null })
    })
})

describe('useWechatFans.sync', () => {
    it('成功后把任务结果回传给调用方', async () => {
        const { result } = renderHook(() => useWechatFans('acc-1'))
        await waitFor(() => {
            expect(result.current.status).toBe('ready')
        })

        await act(async () => {
            const response = await result.current.sync()
            expect(response.task.status).toBe('partial')
            expect(response.task.fetched).toBe(120)
        })
        expect(result.current.isSyncing).toBe(false)
    })

    it('失败时上抛错误并保留错误态', async () => {
        const { result } = renderHook(() => useWechatFans('acc-1'))
        await waitFor(() => {
            expect(result.current.status).toBe('ready')
        })

        requestMock.mockImplementationOnce((method: string): Promise<unknown> => {
            expect(method).toBe('wechat/fans/sync')
            return Promise.reject(new Error('同步失败'))
        })

        let caught: unknown = null
        await act(async () => {
            try {
                await result.current.sync()
            } catch (cause) {
                caught = cause
            }
        })
        expect(caught).toBeInstanceOf(Error)
        expect(result.current.syncError).not.toBeNull()
        expect(result.current.isSyncing).toBe(false)
    })

    it('最近任务可续跑时带上 taskId', async () => {
        requestMock.mockImplementation((method: string): Promise<unknown> => {
            if (method === 'wechat/fans/sync/status') {
                return Promise.resolve({ task: makeTask('task-resume', 'running') })
            }
            if (method === 'wechat/fans/sync') {
                return Promise.resolve({ task: makeTask('task-resume', 'success') })
            }
            return Promise.resolve({ fans: [], tags: [], total: 0, snapshotTotal: 0, task: null })
        })

        const { result } = renderHook(() => useWechatFans('acc-1'))
        await waitFor(() => {
            expect(result.current.syncTask?.id).toBe('task-resume')
        })
        requestMock.mockClear()

        await act(async () => {
            await result.current.sync()
        })
        const syncCall = requestMock.mock.calls.find(([method]) => method === 'wechat/fans/sync')
        expect(syncCall?.[1]).toMatchObject({ taskId: 'task-resume' })
    })

    it('最近任务已成功时不带 taskId，重新发起同步', async () => {
        requestMock.mockImplementation((method: string): Promise<unknown> => {
            if (method === 'wechat/fans/sync/status') {
                return Promise.resolve({ task: makeTask('task-done', 'success') })
            }
            if (method === 'wechat/fans/sync') {
                return Promise.resolve({ task: makeTask('task-new', 'running') })
            }
            return Promise.resolve({ fans: [], tags: [], total: 0, snapshotTotal: 0, task: null })
        })

        const { result } = renderHook(() => useWechatFans('acc-1'))
        await waitFor(() => {
            expect(result.current.syncTask?.id).toBe('task-done')
        })
        requestMock.mockClear()

        await act(async () => {
            await result.current.sync()
        })
        const syncCall = requestMock.mock.calls.find(([method]) => method === 'wechat/fans/sync')
        expect(syncCall?.[1]).toEqual({ accountId: 'acc-1' })
    })
})
