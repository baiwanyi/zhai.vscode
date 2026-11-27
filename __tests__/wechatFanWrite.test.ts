/**
 * 用户写操作服务的单元测试：覆盖标签 CRUD、打标与取消、备注清除、黑名单以及错误码归一。
 * 平台写接口与 Token 依赖以桩替换，只用内存库验证本地快照是否按预期更新，不触网。
 * 断言集中在「平台成功后本地是否同步」与「失败是否给出可执行中文提示」两处。
 */
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WechatTokenAccessDeps } from '../src/modules/wechat/accountToken'
import type { WechatSecretStore } from '../src/modules/wechat/credentials'
import type { WechatTokenService } from '../src/modules/wechat/tokenService'

/** 测试桩状态：failCode 非 null 时所有写接口返回失败 */
const fake = vi.hoisted(() => ({
    failCode: null as number | null,
    tagName: '新标签',
    tagId: 7,
}))

vi.mock('../src/modules/wechat/accountToken', () => ({
    requireWechatToken: (): Promise<{ account: { id: string }; accessToken: string }> =>
        Promise.resolve({ account: { id: 'acc-1' }, accessToken: 'fake-token' }),
}))

vi.mock('../src/modules/wechat/openapi', async () => {
    const actual = await vi.importActual('../src/modules/wechat/openapi')
    const failure = (): { ok: false; errorCode: number; message: string } => ({
        ok: false,
        errorCode: fake.failCode ?? -1,
        message: '原始英文错误',
    })
    return {
        ...actual,
        createWechatTag: (): Promise<unknown> =>
            Promise.resolve(
                fake.failCode === null ? { ok: true, data: { id: fake.tagId, name: fake.tagName } } : failure(),
            ),
        updateWechatTag: (): Promise<unknown> =>
            Promise.resolve(fake.failCode === null ? { ok: true, data: true } : failure()),
        deleteWechatTag: (): Promise<unknown> =>
            Promise.resolve(fake.failCode === null ? { ok: true, data: true } : failure()),
        changeWechatTagMembers: (): Promise<unknown> =>
            Promise.resolve(fake.failCode === null ? { ok: true, data: true } : failure()),
        updateWechatRemark: (): Promise<unknown> =>
            Promise.resolve(fake.failCode === null ? { ok: true, data: true } : failure()),
        changeWechatBlacklist: (): Promise<unknown> =>
            Promise.resolve(fake.failCode === null ? { ok: true, data: true } : failure()),
    }
})

const { WechatFanWriteService } = await import('../src/modules/wechat/fanWriteService')
const { describeFanError } = await import('../src/modules/wechat/openapi')
const { findWechatFan, listWechatTags, upsertWechatFan } = await import('../src/modules/wechat/db/fanRepository')

/** 只建写服务用到的表 */
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
`

/** 造依赖：Token 相关依赖被 mock，只为满足类型 */
function createDeps(db: Database.Database): WechatTokenAccessDeps {
    return {
        db,
        secrets: {} as WechatSecretStore,
        tokens: {} as WechatTokenService,
    }
}

/** 写入一条带标签的用户快照 */
function saveFan(db: Database.Database, openid: string, tagIds: string): void {
    upsertWechatFan(db, {
        accountId: 'acc-1',
        openid,
        unionid: null,
        nickname: '读者',
        avatar: null,
        subscribeStatus: 1,
        subscribedAt: null,
        remark: '旧备注',
        country: null,
        province: null,
        city: null,
        language: null,
        subscribeScene: null,
        qrScene: null,
        tagIds,
        isBlocked: false,
        lastSyncedAt: '2026-11-27T10:00:00.000Z',
        createdAt: '2026-11-27T10:00:00.000Z',
        updatedAt: '2026-11-27T10:00:00.000Z',
    })
}

beforeEach(() => {
    fake.failCode = null
    fake.tagName = '新标签'
    fake.tagId = 7
})

describe('WechatFanWriteService 标签操作', () => {
    it('新建标签成功后写入本地标签表', async () => {
        const db = new Database(':memory:')
        db.exec(SCHEMA)
        const service = new WechatFanWriteService(createDeps(db))
        const result = await service.createTag({ accountId: 'acc-1', name: '  老读者  ' })

        expect(result.tag.id).toBe(7)
        expect(result.tag.name).toBe('新标签')
        expect(listWechatTags(db, 'acc-1')).toHaveLength(1)
    })

    it('重命名标签保留已有计数', async () => {
        const db = new Database(':memory:')
        db.exec(SCHEMA)
        db.prepare('INSERT INTO wechat_tags VALUES (?, ?, ?, ?, ?)').run('acc-1', 7, '旧名', 12, '2026-11-01')
        const service = new WechatFanWriteService(createDeps(db))
        const result = await service.renameTag({ accountId: 'acc-1', id: 7, name: '新名' })

        expect(result.tag.count).toBe(12)
        expect(listWechatTags(db, 'acc-1')[0]?.name).toBe('新名')
    })

    it('删除标签成功后清理本地映射', async () => {
        const db = new Database(':memory:')
        db.exec(SCHEMA)
        db.prepare('INSERT INTO wechat_tags VALUES (?, ?, ?, ?, ?)').run('acc-1', 7, '待删', 0, '2026-11-01')
        const service = new WechatFanWriteService(createDeps(db))
        const result = await service.removeTag({ accountId: 'acc-1', id: 7 })

        expect(result.removed).toBe(true)
        expect(listWechatTags(db, 'acc-1')).toHaveLength(0)
    })

    it('平台失败时返回中文可执行提示', async () => {
        const db = new Database(':memory:')
        db.exec(SCHEMA)
        fake.failCode = 45017
        const service = new WechatFanWriteService(createDeps(db))

        await expect(service.createTag({ accountId: 'acc-1', name: '标签' })).rejects.toThrow('标签数量已达平台上限')
        expect(listWechatTags(db, 'acc-1')).toHaveLength(0)
    })
})

describe('WechatFanWriteService 用户操作', () => {
    it('打标与取消更新本地 tag_ids 且升序去重', async () => {
        const db = new Database(':memory:')
        db.exec(SCHEMA)
        saveFan(db, 'o1', '[3]')
        const service = new WechatFanWriteService(createDeps(db))

        await service.tagMembers({ accountId: 'acc-1', openids: ['o1'], tagId: 7, action: 'add' })
        expect(findWechatFan(db, 'acc-1', 'o1')?.tag_ids).toBe('[3,7]')

        await service.tagMembers({ accountId: 'acc-1', openids: ['o1'], tagId: 3, action: 'remove' })
        expect(findWechatFan(db, 'acc-1', 'o1')?.tag_ids).toBe('[7]')
    })

    it('备注写成功后同步本地，空串清除', async () => {
        const db = new Database(':memory:')
        db.exec(SCHEMA)
        saveFan(db, 'o1', '[]')
        const service = new WechatFanWriteService(createDeps(db))

        await service.remark({ accountId: 'acc-1', openid: 'o1', remark: '新备注' })
        expect(findWechatFan(db, 'acc-1', 'o1')?.remark).toBe('新备注')

        await service.remark({ accountId: 'acc-1', openid: 'o1', remark: '' })
        expect(findWechatFan(db, 'acc-1', 'o1')?.remark).toBeNull()
    })

    it('拉黑不改本地关注状态', async () => {
        const db = new Database(':memory:')
        db.exec(SCHEMA)
        saveFan(db, 'o1', '[]')
        const service = new WechatFanWriteService(createDeps(db))
        const result = await service.blacklist({ accountId: 'acc-1', openids: ['o1'], action: 'block' })

        expect(result.succeeded).toBe(1)
        expect(findWechatFan(db, 'acc-1', 'o1')?.subscribe_status).toBe(1)
    })
})

describe('describeFanError', () => {
    it('登记的错误码返回专属中文提示', () => {
        expect(describeFanError(45104)).toContain('20 个标签')
        expect(describeFanError(48001)).toContain('未获得此接口权限')
    })

    it('未知错误码走兜底且不含英文 errmsg', () => {
        expect(describeFanError(99999)).toBe('操作失败，请稍后重试')
    })
})
