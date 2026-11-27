/**
 * 用户同步服务的单元测试：覆盖游标翻页、100 分批、资料缺失降级、额度中断与断点续跑。
 * 平台接口与 Token 依赖全部以桩替换，只用内存库验证任务游标与快照落库，不触网、不依赖宿主。
 * 断言集中在「有没有漏人」与「失败后游标是否保住」两处，避免只验证快乐路径。
 */
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WechatTokenAccessDeps } from '../src/modules/wechat/accountToken'
import type { WechatSecretStore } from '../src/modules/wechat/credentials'
import type { WechatTokenService } from '../src/modules/wechat/tokenService'

/** 测试桩里的平台页结果 */
interface FakePage {
    openids: string[]
    nextOpenid?: string
    total: number
}

/** 测试桩里的分页接口结果 */
type FakePageOutcome = { ok: true; data: FakePage } | { ok: false; errorCode: number; message: string }

/** 测试桩的可变状态：vi.hoisted 保证在 mock 工厂之前初始化 */
const fake = vi.hoisted(() => ({
    pages: new Map<string, { openids: string[]; nextOpenid?: string; total: number }>(),
    profiles: new Map<string, Record<string, unknown>>(),
    failPage: null as { errorCode: number; message: string } | null,
    pageCursors: [] as Array<string | undefined>,
    profileCalls: [] as string[][],
    blacklist: [] as string[],
}))

vi.mock('../src/modules/wechat/accountToken', () => ({
    requireWechatToken: (): Promise<{ account: { id: string }; accessToken: string }> =>
        Promise.resolve({ account: { id: 'acc-1' }, accessToken: 'fake-token' }),
}))

vi.mock('../src/modules/wechat/openapi', () => ({
    fetchWechatTags: (): Promise<{ ok: true; data: [] }> => Promise.resolve({ ok: true, data: [] }),
    fetchWechatBlacklist: (): Promise<{ ok: true; data: { openids: string[]; total: number } }> =>
        Promise.resolve({ ok: true, data: { openids: fake.blacklist, total: fake.blacklist.length } }),
    fetchWechatFanPage: (_token: string, cursor?: string): Promise<FakePageOutcome> => {
        fake.pageCursors.push(cursor)
        if (fake.failPage !== null) {
            return Promise.resolve({
                ok: false,
                errorCode: fake.failPage.errorCode,
                message: fake.failPage.message,
            })
        }
        return Promise.resolve({
            ok: true,
            data: fake.pages.get(cursor ?? '') ?? { openids: [], total: 0 },
        })
    },
    fetchWechatFanProfiles: (
        _token: string,
        openids: string[],
    ): Promise<{ ok: true; data: Array<Record<string, unknown>> }> => {
        fake.profileCalls.push(openids)
        const data = openids
            .filter((openid) => fake.profiles.has(openid))
            .map((openid) => fake.profiles.get(openid))
            .filter((item): item is Record<string, unknown> => item !== undefined)
        return Promise.resolve({ ok: true, data })
    },
}))

const { WechatFanSyncService } = await import('../src/modules/wechat/fanSyncService')
const { countAllWechatFans, findSyncTask } = await import('../src/modules/wechat/db/fanRepository')

/** 只建同步服务用到的表 */
const SCHEMA = `
CREATE TABLE wechat_fans (
    account_id TEXT NOT NULL, openid TEXT NOT NULL, unionid TEXT, nickname TEXT NOT NULL DEFAULT '',
    avatar TEXT, subscribe_status INTEGER NOT NULL DEFAULT 0, subscribed_at TEXT, remark TEXT,
    country TEXT, province TEXT, city TEXT, language TEXT, subscribe_scene TEXT, qr_scene TEXT,
    tag_ids TEXT NOT NULL DEFAULT '[]', is_blocked INTEGER NOT NULL DEFAULT 0,
    last_synced_at TEXT NOT NULL, created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL, PRIMARY KEY (account_id, openid)
);
CREATE TABLE wechat_tags (
    account_id TEXT NOT NULL, tag_id INTEGER NOT NULL, name TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL, PRIMARY KEY (account_id, tag_id)
);
CREATE TABLE wechat_sync_tasks (
    id TEXT PRIMARY KEY, account_id TEXT NOT NULL, status TEXT NOT NULL, cursor TEXT NOT NULL DEFAULT '',
    page_count INTEGER NOT NULL DEFAULT 0, fetched INTEGER NOT NULL DEFAULT 0, created_count INTEGER NOT NULL DEFAULT 0,
    updated_count INTEGER NOT NULL DEFAULT 0, unfollowed INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0,
    error_code INTEGER, error_hint TEXT, started_at TEXT NOT NULL, finished_at TEXT
);
INSERT INTO wechat_fans
    (account_id, openid, unionid, nickname, avatar, subscribe_status, subscribed_at, remark,
     country, province, city, language, subscribe_scene, qr_scene, tag_ids, last_synced_at, created_at, updated_at)
VALUES ('acc-1', 'o-stale', NULL, '已取关用户', NULL, 1, '2026-01-01T00:00:00.000Z', NULL,
        NULL, NULL, NULL, NULL, NULL, NULL, '[]', '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
`

/** 造依赖：Token 相关依赖被 mock，只为满足类型 */
function createDeps(db: Database.Database): WechatTokenAccessDeps {
    return {
        db,
        secrets: {} as WechatSecretStore,
        tokens: {} as WechatTokenService,
    }
}

/** 造一页 openid */
function makeOpenids(prefix: string, count: number, offset = 0): string[] {
    return Array.from({ length: count }, (_, index) => `${prefix}${String(offset + index)}`)
}

beforeEach(() => {
    fake.pages.clear()
    fake.profiles.clear()
    fake.failPage = null
    fake.pageCursors = []
    fake.profileCalls = []
    fake.blacklist = []
})

describe('WechatFanSyncService.sync', () => {
    it('收尾时回读黑名单并标记落库', async () => {
        const db = new Database(':memory:')
        db.exec(SCHEMA)
        fake.pages.set('', { openids: ['o1', 'o2'], total: 2 })
        fake.blacklist = ['o1']

        const service = new WechatFanSyncService(createDeps(db))
        const result = await service.sync({ accountId: 'acc-1' })

        const { findWechatFan } = await import('../src/modules/wechat/db/fanRepository')
        expect(result.task.status).toBe('success')
        expect(findWechatFan(db, 'acc-1', 'o1')?.is_blocked).toBe(1)
        expect(findWechatFan(db, 'acc-1', 'o2')?.is_blocked).toBe(0)
    })

    it('250 人分三页拉取且每批资料不超过 100 个', async () => {
        const db = new Database(':memory:')
        db.exec(SCHEMA)
        fake.pages.set('', { openids: makeOpenids('o', 250), nextOpenid: 'page-2', total: 250 })
        fake.pages.set('page-2', { openids: [], total: 250 })
        expect(countAllWechatFans(db, 'acc-1')).toBe(1)

        const service = new WechatFanSyncService(createDeps(db))
        const result = await service.sync({ accountId: 'acc-1' })

        expect(result.task.status).toBe('success')
        expect(result.task.fetched).toBe(250)
        expect(countAllWechatFans(db, 'acc-1')).toBe(251)
        expect(fake.profileCalls.every((call) => call.length <= 100)).toBe(true)
        expect(fake.profileCalls.reduce((sum, call) => sum + call.length, 0)).toBe(250)
    })

    it('UnionID 与标签随资料一起落库', async () => {
        const db = new Database(':memory:')
        db.exec(SCHEMA)
        fake.pages.set('', { openids: ['o1'], total: 1 })
        fake.profiles.set('o1', {
            openid: 'o1',
            unionid: 'u-1234567890',
            nickname: '张三',
            subscribeStatus: 1,
            tagIds: [3, 13],
        })

        const service = new WechatFanSyncService(createDeps(db))
        await service.sync({ accountId: 'acc-1' })

        const { findWechatFan } = await import('../src/modules/wechat/db/fanRepository')
        const row = findWechatFan(db, 'acc-1', 'o1')
        expect(row?.unionid).toBe('u-1234567890')
        expect(row?.tag_ids).toBe('[3,13]')
    })

    it('资料缺失时降级为只有 openid，不计入整批失败', async () => {
        const db = new Database(':memory:')
        db.exec(SCHEMA)
        fake.pages.set('', { openids: ['o1', 'o2'], total: 2 })

        const service = new WechatFanSyncService(createDeps(db))
        const result = await service.sync({ accountId: 'acc-1' })

        expect(result.task.status).toBe('success')
        expect(result.task.failedCount).toBe(2)
        expect(countAllWechatFans(db, 'acc-1')).toBe(3)
    })

    it('单次调用最多处理五页，剩余页留待续跑', async () => {
        const db = new Database(':memory:')
        db.exec(SCHEMA)
        for (let index = 0; index < 6; index += 1) {
            const cursor = index === 0 ? '' : `page-${String(index)}`
            fake.pages.set(cursor, {
                openids: makeOpenids('o', 1, index),
                ...(index < 5 ? { nextOpenid: `page-${String(index + 1)}` } : {}),
                total: 6,
            })
        }

        const service = new WechatFanSyncService(createDeps(db))
        const result = await service.sync({ accountId: 'acc-1' })

        expect(result.task.status).toBe('running')
        expect(result.task.cursor).toBe('page-5')
        expect(result.task.fetched).toBe(5)
        expect(fake.pageCursors).toHaveLength(5)
    })

    it('额度耗尽记为 partial 且保留游标与计数', async () => {
        const db = new Database(':memory:')
        db.exec(SCHEMA)
        fake.failPage = { errorCode: 45009, message: '接口调用超过当日额度' }

        const service = new WechatFanSyncService(createDeps(db))
        const result = await service.sync({ accountId: 'acc-1' })

        expect(result.task.status).toBe('partial')
        expect(result.task.errorCode).toBe(45009)
        expect(result.task.cursor).toBe('')
        expect(findSyncTask(db, 'acc-1', result.task.id)?.status).toBe('partial')
    })

    it('非额度错误记为 failed 并保留任务行', async () => {
        const db = new Database(':memory:')
        db.exec(SCHEMA)
        fake.failPage = { errorCode: -1, message: '网络异常' }

        const service = new WechatFanSyncService(createDeps(db))
        const result = await service.sync({ accountId: 'acc-1' })

        expect(result.task.status).toBe('failed')
        expect(findSyncTask(db, 'acc-1', result.task.id)?.error_code).toBe(-1)
    })

    it('续跑从保存的游标继续且不重复计入已完成页', async () => {
        const db = new Database(':memory:')
        db.exec(SCHEMA)
        fake.pages.set('', { openids: makeOpenids('a', 100), nextOpenid: 'next-page', total: 200 })
        fake.pages.set('next-page', { openids: makeOpenids('b', 100), total: 200 })

        const service = new WechatFanSyncService(createDeps(db))
        const first = await service.sync({ accountId: 'acc-1' })
        const second = await service.sync({ accountId: 'acc-1', taskId: first.task.id })

        expect(second.task.status).toBe('success')
        expect(second.task.fetched).toBe(200)
        expect(fake.pageCursors).toEqual(['', 'next-page'])
    })

    it('收尾时把本轮未出现的关注者标为已取关', async () => {
        const db = new Database(':memory:')
        db.exec(SCHEMA)
        fake.pages.set('', { openids: makeOpenids('o', 1), total: 1 })

        const service = new WechatFanSyncService(createDeps(db))
        const result = await service.sync({ accountId: 'acc-1' })

        const { findWechatFan } = await import('../src/modules/wechat/db/fanRepository')
        expect(result.task.unfollowed).toBe(1)
        expect(findWechatFan(db, 'acc-1', 'o-stale')?.subscribe_status).toBe(0)
    })
})
