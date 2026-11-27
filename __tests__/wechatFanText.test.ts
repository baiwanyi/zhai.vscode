/**
 * 用户管理文案纯函数用例：覆盖同步结果级别映射与页头描述三态。
 * 复用约定：直接调用 fans/utils 下的纯函数，不渲染组件、不接管 bridge。
 * 关键约束：success / partial / running 都按成功级但文案区分续跑语义，失败级优先 errorHint；
 * 页头快照态的平台总数必须取同步任务，实时态明示首屏口径。
 */
import { describe, expect, it } from 'vitest'
import type { WechatFanSyncTask } from '@shared/types/wechat'
import { readPageDescription } from '../src/workflow/wechat/fans/utils/pageText'
import { describeSyncResult } from '../src/workflow/wechat/fans/utils/syncText'

/** 构造任务：仅覆盖文案函数用到的字段 */
function makeTask(status: WechatFanSyncTask['status'], errorHint?: string): WechatFanSyncTask {
    return {
        id: 'task-1',
        status,
        cursor: '',
        pageCount: 1,
        fetched: 120,
        total: 250,
        createdCount: 10,
        updatedCount: 20,
        unfollowed: 0,
        failedCount: 0,
        startedAt: '2026-11-27T10:00:00.000Z',
        ...(errorHint === undefined ? {} : { errorHint }),
    }
}

describe('describeSyncResult', () => {
    it('成功、部分完成与运行中均按成功级且文案区分', () => {
        expect(describeSyncResult(makeTask('success'))).toEqual({
            level: 'success',
            message: '同步完成：已拉取 120 / 250 · 新增 10 · 更新 20',
        })
        expect(describeSyncResult(makeTask('partial')).message).toContain('可继续同步')
        expect(describeSyncResult(makeTask('running')).message).toContain('已拉取部分关注者')
    })

    it('失败级优先展示 errorHint，缺省时回落进度串', () => {
        expect(describeSyncResult(makeTask('failed', '额度不足'))).toEqual({
            level: 'error',
            message: '同步失败：额度不足',
        })
        expect(describeSyncResult(makeTask('failed')).message).toContain('已拉取 120 / 250')
    })
})

describe('readPageDescription', () => {
    const base = {
        tags: [],
        isSnapshot: false,
        syncedAt: null,
        total: 250,
        snapshotTotal: 250,
        fans: [],
        syncTask: null,
    }

    it('标签段只报标签数', () => {
        expect(readPageDescription('公众号', 'tags', { ...base, tags: [{ id: 1, name: 'A', count: 2 }] })).toBe(
            '公众号 · 1 个标签',
        )
    })

    it('快照态平台数取同步任务，无任务时明示未知', () => {
        const snapshot = { ...base, isSnapshot: true }
        expect(readPageDescription('公众号', 'fans', snapshot)).toContain('平台总数未知')
        expect(
            readPageDescription('公众号', 'fans', {
                ...snapshot,
                syncTask: makeTask('success'),
            }),
        ).toContain('平台 250 / 已同步 250')
    })

    it('实时态明示首屏口径', () => {
        expect(readPageDescription('公众号', 'fans', { ...base, fans: [{ openid: 'a', nickname: 'a', subscribeStatus: 1, tagIds: [], isBlocked: false }] })).toBe(
            '公众号 · 共 250 位，显示前 1 位（实时）',
        )
    })

    it('同步时间非法时不产生空尾', () => {
        const text = readPageDescription('公众号', 'fans', {
            ...base,
            isSnapshot: true,
            syncedAt: 'not-a-date',
            syncTask: makeTask('success'),
        })
        expect(text).not.toContain('同步于')
    })
})
