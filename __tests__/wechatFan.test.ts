/**
 * 公众号用户管理契约与仓储的单元测试：覆盖请求收窄、快照读写、精确标签筛选、LIKE 转义与账号清理。
 * 纯内存库测试，不触网、不依赖 SecretStorage 与宿主状态。
 * 断言集中在「哪些输入被拒绝」与「快照是否按平台口径覆盖」两处，避免只验证快乐路径。
 */
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import {
    countAllWechatFans,
    countWechatFans,
    deleteAccountFanData,
    findWechatFan,
    insertSyncTask,
    listWechatFans,
    syncWechatFanBlocked,
    updateWechatFanBlocked,
    upsertWechatFan,
    type WechatFanRow,
} from '../src/modules/wechat/db/fanRepository'
import {
    isWechatFanBlacklistRequest,
    isWechatFanDetailRequest,
    isWechatFanRemarkRequest,
    isWechatFanSearchRequest,
    isWechatFanSyncRequest,
    isWechatFanTagCreateRequest,
    isWechatFanTagMembersRequest,
    isWechatFanTagRemoveRequest,
    isWechatFanTagRenameRequest,
} from '../src/shared/types/wechat'

/** 合法账号 id：形态收窄与账号服务一致 */
const ACCOUNT_ID = 'acc-1a2b3c4d5e'

/** 只建本测试用到的表，DDL 与 connection.ts 保持一致 */
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

/** 建内存库并装好表结构 */
function createDb(): Database.Database {
    const db = new Database(':memory:')
    db.exec(SCHEMA)
    return db
}

/** 造一条用户快照行 */
function fanRow(openid: string, nickname: string, tagIds: string, remark: string | null = null): WechatFanRow {
    return {
        account_id: ACCOUNT_ID,
        openid,
        unionid: null,
        nickname,
        avatar: null,
        subscribe_status: 1,
        subscribed_at: '2026-11-01T08:00:00.000Z',
        remark,
        country: '中国',
        province: '广东',
        city: '深圳',
        language: 'zh_CN',
        subscribe_scene: 'ADD_SCENE_SEARCH',
        qr_scene: null,
        tag_ids: tagIds,
        is_blocked: 0,
        last_synced_at: '2026-11-27T10:00:00.000Z',
        created_at: '2026-11-27T10:00:00.000Z',
        updated_at: '2026-11-27T10:00:00.000Z',
    }
}

/** 写入用户快照的测试入口 */
function saveFan(db: Database.Database, row: WechatFanRow): void {
    upsertWechatFan(db, {
        accountId: row.account_id,
        openid: row.openid,
        unionid: row.unionid,
        nickname: row.nickname,
        avatar: row.avatar,
        subscribeStatus: row.subscribe_status,
        subscribedAt: row.subscribed_at,
        remark: row.remark,
        country: row.country,
        province: row.province,
        city: row.city,
        language: row.language,
        subscribeScene: row.subscribe_scene,
        qrScene: row.qr_scene,
        tagIds: row.tag_ids,
        isBlocked: row.is_blocked === 1,
        lastSyncedAt: row.last_synced_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    })
}

describe('isWechatFanSearchRequest', () => {
    it('接受全缺省的检索请求', () => {
        expect(isWechatFanSearchRequest({ accountId: ACCOUNT_ID })).toBe(true)
    })

    it('拒绝非法关注状态与负偏移', () => {
        expect(isWechatFanSearchRequest({ accountId: ACCOUNT_ID, subscribeStatus: 2 })).toBe(false)
        expect(isWechatFanSearchRequest({ accountId: ACCOUNT_ID, offset: -1 })).toBe(false)
    })

    it('拒绝非整数标签与超长关键词', () => {
        expect(isWechatFanSearchRequest({ accountId: ACCOUNT_ID, tagId: 1.5 })).toBe(false)
        expect(isWechatFanSearchRequest({ accountId: ACCOUNT_ID, keyword: 'a'.repeat(65) })).toBe(false)
    })

    it('接受布尔 isBlocked，拒绝非布尔值', () => {
        expect(isWechatFanSearchRequest({ accountId: ACCOUNT_ID, isBlocked: true })).toBe(true)
        expect(isWechatFanSearchRequest({ accountId: ACCOUNT_ID, isBlocked: 'true' })).toBe(false)
    })
})

describe('isWechatFanDetailRequest', () => {
    it('接受合法 openid', () => {
        expect(isWechatFanDetailRequest({ accountId: ACCOUNT_ID, openid: 'oxxxxxxxxxxxxxxxxxxxx' })).toBe(true)
    })

    it('拒绝空 openid 与非字符串', () => {
        expect(isWechatFanDetailRequest({ accountId: ACCOUNT_ID, openid: '' })).toBe(false)
        expect(isWechatFanDetailRequest({ accountId: ACCOUNT_ID, openid: 123 })).toBe(false)
    })
})

describe('isWechatFanSyncRequest', () => {
    it('新建与续跑都可通过', () => {
        expect(isWechatFanSyncRequest({ accountId: ACCOUNT_ID })).toBe(true)
        expect(isWechatFanSyncRequest({ accountId: ACCOUNT_ID, taskId: 'task-1' })).toBe(true)
    })

    it('拒绝非字符串 taskId', () => {
        expect(isWechatFanSyncRequest({ accountId: ACCOUNT_ID, taskId: 1 })).toBe(false)
    })
})

describe('isWechatFanTagCreateRequest', () => {
    it('接受正常标签名', () => {
        expect(isWechatFanTagCreateRequest({ accountId: ACCOUNT_ID, name: '老读者' })).toBe(true)
    })

    it('拒绝空白名与超长名', () => {
        expect(isWechatFanTagCreateRequest({ accountId: ACCOUNT_ID, name: '   ' })).toBe(false)
        expect(isWechatFanTagCreateRequest({ accountId: ACCOUNT_ID, name: '标'.repeat(31) })).toBe(false)
    })
})

describe('isWechatFanTagRenameRequest', () => {
    it('接受正整数 id', () => {
        expect(isWechatFanTagRenameRequest({ accountId: ACCOUNT_ID, id: 3, name: '新名' })).toBe(true)
    })

    it('拒绝 0 与小数 id', () => {
        expect(isWechatFanTagRenameRequest({ accountId: ACCOUNT_ID, id: 0, name: '新名' })).toBe(false)
        expect(isWechatFanTagRenameRequest({ accountId: ACCOUNT_ID, id: 1.5, name: '新名' })).toBe(false)
    })
})

describe('isWechatFanTagRemoveRequest', () => {
    it('只接受正整数 id', () => {
        expect(isWechatFanTagRemoveRequest({ accountId: ACCOUNT_ID, id: 1 })).toBe(true)
        expect(isWechatFanTagRemoveRequest({ accountId: ACCOUNT_ID, id: -1 })).toBe(false)
    })
})

describe('isWechatFanTagMembersRequest', () => {
    it('接受 1~100 个 openid 与合法动作', () => {
        expect(isWechatFanTagMembersRequest({ accountId: ACCOUNT_ID, openids: ['o1'], tagId: 1, action: 'add' })).toBe(
            true,
        )
        expect(
            isWechatFanTagMembersRequest({
                accountId: ACCOUNT_ID,
                openids: Array.from({ length: 100 }, (_, index) => `o${String(index)}`),
                tagId: 1,
                action: 'remove',
            }),
        ).toBe(true)
    })

    it('拒绝空数组、超限与非法动作', () => {
        expect(isWechatFanTagMembersRequest({ accountId: ACCOUNT_ID, openids: [], tagId: 1, action: 'add' })).toBe(
            false,
        )
        expect(
            isWechatFanTagMembersRequest({
                accountId: ACCOUNT_ID,
                openids: Array.from({ length: 101 }, (_, index) => `o${String(index)}`),
                tagId: 1,
                action: 'add',
            }),
        ).toBe(false)
        expect(
            isWechatFanTagMembersRequest({ accountId: ACCOUNT_ID, openids: ['o1'], tagId: 1, action: 'delete' }),
        ).toBe(false)
    })
})

describe('isWechatFanRemarkRequest', () => {
    it('空串表示清除备注，可通过', () => {
        expect(isWechatFanRemarkRequest({ accountId: ACCOUNT_ID, openid: 'o1', remark: '' })).toBe(true)
    })

    it('拒绝纯空白与超长备注', () => {
        expect(isWechatFanRemarkRequest({ accountId: ACCOUNT_ID, openid: 'o1', remark: '   ' })).toBe(false)
        expect(isWechatFanRemarkRequest({ accountId: ACCOUNT_ID, openid: 'o1', remark: 'a'.repeat(31) })).toBe(false)
    })
})

describe('isWechatFanBlacklistRequest', () => {
    it('只接受 block 与 unblock', () => {
        expect(isWechatFanBlacklistRequest({ accountId: ACCOUNT_ID, openids: ['o1'], action: 'block' })).toBe(true)
        expect(isWechatFanBlacklistRequest({ accountId: ACCOUNT_ID, openids: ['o1'], action: 'unblock' })).toBe(true)
        expect(isWechatFanBlacklistRequest({ accountId: ACCOUNT_ID, openids: ['o1'], action: 'remove' })).toBe(false)
    })

    it('拒绝空 openid 数组', () => {
        expect(isWechatFanBlacklistRequest({ accountId: ACCOUNT_ID, openids: [], action: 'block' })).toBe(false)
    })

    it('一次最多 20 个 openid，超出按平台限制拒绝', () => {
        const openids = (count: number): string[] => Array.from({ length: count }, (_, index) => `o${String(index)}`)
        expect(isWechatFanBlacklistRequest({ accountId: ACCOUNT_ID, openids: openids(20), action: 'block' })).toBe(true)
        expect(isWechatFanBlacklistRequest({ accountId: ACCOUNT_ID, openids: openids(21), action: 'block' })).toBe(
            false,
        )
    })
})

describe('fanRepository 快照读写', () => {
    it('upsert 覆盖同账号同 openid 的旧值', () => {
        const db = createDb()
        saveFan(db, fanRow('o1', '旧昵称', '[]'))
        saveFan(db, fanRow('o1', '新昵称', '[3]'))
        expect(findWechatFan(db, ACCOUNT_ID, 'o1')?.nickname).toBe('新昵称')
        expect(findWechatFan(db, ACCOUNT_ID, 'o1')?.tag_ids).toBe('[3]')
    })

    it('标签筛选精确匹配：3 不命中 13', () => {
        const db = createDb()
        saveFan(db, fanRow('o1', '甲', '[3]'))
        saveFan(db, fanRow('o2', '乙', '[13]'))
        expect(listWechatFans(db, ACCOUNT_ID, { tagId: 3 }).map((row) => row.openid)).toEqual(['o1'])
        expect(countWechatFans(db, ACCOUNT_ID, { tagId: 3 })).toBe(1)
    })

    it('关键词里的 LIKE 通配符按普通字符处理', () => {
        const db = createDb()
        saveFan(db, fanRow('o1', '百分之百', '[]'))
        saveFan(db, fanRow('o2', '普通读者', '[]'))
        expect(listWechatFans(db, ACCOUNT_ID, { keyword: '%' })).toHaveLength(0)
        expect(listWechatFans(db, ACCOUNT_ID, { keyword: '读者' })).toHaveLength(1)
    })

    it('关键词可命中 openid 尾号', () => {
        const db = createDb()
        saveFan(db, fanRow('oabcdef123456', '昵称', '[]'))
        expect(listWechatFans(db, ACCOUNT_ID, { keyword: '123456' })).toHaveLength(1)
    })

    it('删除账号时清理该账号的用户快照', () => {
        const db = createDb()
        saveFan(db, fanRow('o1', '甲', '[]'))
        insertSyncTask(db, {
            id: 'task-1',
            accountId: ACCOUNT_ID,
            status: 'running',
            cursor: '',
            pageCount: 0,
            fetched: 0,
            createdCount: 0,
            updatedCount: 0,
            unfollowed: 0,
            failedCount: 0,
            total: 0,
            errorCode: null,
            errorHint: null,
            startedAt: '2026-11-27T10:00:00.000Z',
            finishedAt: null,
        })
        expect(countAllWechatFans(db, ACCOUNT_ID)).toBe(1)
        deleteAccountFanData(db, ACCOUNT_ID)
        expect(countAllWechatFans(db, ACCOUNT_ID)).toBe(0)
    })
})

describe('fanRepository 黑名单标记', () => {
    it('全量回读覆盖旧标记，已解除的用户不再保留', () => {
        const db = createDb()
        saveFan(db, fanRow('o1', '甲', '[]'))
        saveFan(db, fanRow('o2', '乙', '[]'))
        const now = '2026-11-27T12:00:00.000Z'
        syncWechatFanBlocked(db, ACCOUNT_ID, ['o1'], now)
        expect(findWechatFan(db, ACCOUNT_ID, 'o1')?.is_blocked).toBe(1)
        expect(findWechatFan(db, ACCOUNT_ID, 'o2')?.is_blocked).toBe(0)
        syncWechatFanBlocked(db, ACCOUNT_ID, ['o2'], now)
        expect(findWechatFan(db, ACCOUNT_ID, 'o1')?.is_blocked).toBe(0)
        expect(findWechatFan(db, ACCOUNT_ID, 'o2')?.is_blocked).toBe(1)
    })

    it('写操作只改本次涉及的 openid，不重算整份快照', () => {
        const db = createDb()
        saveFan(db, fanRow('o1', '甲', '[]'))
        saveFan(db, fanRow('o2', '乙', '[]'))
        const now = '2026-11-27T12:00:00.000Z'
        updateWechatFanBlocked(db, ACCOUNT_ID, ['o1'], true, now)
        expect(findWechatFan(db, ACCOUNT_ID, 'o1')?.is_blocked).toBe(1)
        expect(findWechatFan(db, ACCOUNT_ID, 'o2')?.is_blocked).toBe(0)
        updateWechatFanBlocked(db, ACCOUNT_ID, ['o1'], false, now)
        expect(findWechatFan(db, ACCOUNT_ID, 'o1')?.is_blocked).toBe(0)
    })

    it('isBlocked 筛选只命中黑名单用户', () => {
        const db = createDb()
        saveFan(db, fanRow('o1', '甲', '[]'))
        saveFan(db, fanRow('o2', '乙', '[]'))
        syncWechatFanBlocked(db, ACCOUNT_ID, ['o1'], '2026-11-27T12:00:00.000Z')
        expect(listWechatFans(db, ACCOUNT_ID, { isBlocked: true }).map((row) => row.openid)).toEqual(['o1'])
        expect(countWechatFans(db, ACCOUNT_ID, { isBlocked: true })).toBe(1)
        expect(countWechatFans(db, ACCOUNT_ID, { isBlocked: false })).toBe(1)
    })
})
