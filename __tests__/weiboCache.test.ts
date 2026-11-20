/**
 * 微博元数据缓存的单元测试：覆盖账号隔离、逐字段校验、并发落盘与整体清除。
 * 全部走 __tests__/stubs/vscode 的虚拟磁盘，不触网、不读写真实文件。
 * 关键约束：断言以文件内容为准——缓存的核心风险是「把不该存的东西写进存储根」，
 * 因此每条用例都同时检查回包与落盘文本。
 */
import * as path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { WeiboEmoticonsResult, WeiboGroupsResult, WeiboHotRankResult, WeiboProfile } from '@shared/types/weibo'
import { createUri, readDeletedPaths, readFileContent, resetWorkspaceState, setFileContent } from './stubs/vscode'
import { createWeiboCache, toAccountKey } from '../src/modules/weibo/weiboCache'

const STORAGE_ROOT = 'd:/vault'
const CACHE_PATH = path.join(STORAGE_ROOT, 'weibo.json')
const COOKIE = 'SUB=abc123; SUBP=def456'
const ACCOUNT = toAccountKey(COOKIE)
const OTHER_ACCOUNT = toAccountKey('SUB=other')

/** 一份可缓存的分组结果：gid 为数字串、标题非空 */
function groupsResult(): WeiboGroupsResult {
    return {
        defaultGroups: [{ gid: '10001', title: '最新微博', uid: '9001', isCustom: false }],
        myGroups: [{ gid: '20002', title: '自定义分组', uid: '', isCustom: true }],
        timelineListId: '10001',
        uid: '9001',
    }
}

/** 一份可缓存的热搜结果 */
function hotRankResult(): WeiboHotRankResult {
    return {
        items: [
            {
                rank: 1,
                title: '#测试热搜#',
                description: '榜单一',
                iconUrl: 'https://wx1.sinaimg.cn/hot.png',
                iconDesc: '热',
                iconDescColor: '#ff0000',
            },
        ],
        fetchedAt: '2026-11-20T10:00:00.000Z',
    }
}

/** 一份可缓存的表情结果 */
function emoticonsResult(): WeiboEmoticonsResult {
    return {
        emoticons: [{ phrase: '[微笑]', url: 'https://face.t.sinajs.cn/a.png', category: '默认' }],
        fetchedAt: '2026-11-20T11:00:00.000Z',
    }
}

/** 构造缓存文件原文：用于模拟用户手改或旧版本残留 */
function rawFile(entries: Record<string, unknown>, version = 1, accountKey = ACCOUNT): string {
    return JSON.stringify({
        version,
        accountKey,
        warmedAt: null,
        groups: null,
        hotRank: null,
        emoticons: null,
        ...entries,
    })
}

describe('微博元数据缓存', () => {
    beforeEach(() => {
        resetWorkspaceState()
    })

    it('写入分组后同账号可读回，文件里不含 Cookie 明文', async () => {
        const cache = createWeiboCache(createUri(STORAGE_ROOT))
        await cache.write('groups', ACCOUNT, groupsResult(), '2026-11-20T10:00:00.000Z')

        const entry = await cache.readGroups(ACCOUNT)
        expect(entry?.data).toEqual(groupsResult())
        expect(entry?.fetchedAt).toBe('2026-11-20T10:00:00.000Z')

        const raw = readFileContent(CACHE_PATH) ?? ''
        expect(raw).toContain(ACCOUNT)
        expect(raw).toContain('2026-11-20T10:00:00.000Z')
        expect(raw).not.toContain('SUB=')
        expect(raw).not.toContain('SUBP=')
        expect(raw).not.toContain('abc123')
    })

    it('换账号后同一份缓存按未命中处理', async () => {
        const cache = createWeiboCache(createUri(STORAGE_ROOT))
        await cache.write('groups', ACCOUNT, groupsResult(), '2026-11-20T10:00:00.000Z')
        expect(await cache.readGroups(OTHER_ACCOUNT)).toBeNull()
    })

    it('版本不匹配时按空缓存处理', async () => {
        setFileContent(
            CACHE_PATH,
            rawFile({ groups: { fetchedAt: '2026-11-20T10:00:00.000Z', data: groupsResult() } }, 99),
        )
        const cache = createWeiboCache(createUri(STORAGE_ROOT))
        expect(await cache.readGroups(ACCOUNT)).toBeNull()
    })

    it('非法榜单条目在读取时被剔除，合法项保留', async () => {
        setFileContent(
            CACHE_PATH,
            rawFile({
                hotRank: {
                    fetchedAt: '2026-11-20T10:00:00.000Z',
                    data: {
                        fetchedAt: '2026-11-20T10:00:00.000Z',
                        items: [
                            {
                                rank: 1,
                                title: ' 合法条目 ',
                                description: null,
                                iconUrl: 'https://evil.example/a.png',
                                iconDesc: null,
                                iconDescColor: 'javascript:alert(1)',
                            },
                            { rank: 0, title: '名次非法', iconUrl: null, iconDesc: null, iconDescColor: null },
                            { rank: 2, title: '   ', iconUrl: null, iconDesc: null, iconDescColor: null },
                            { rank: 3, title: '非图床图标', iconUrl: 'http://wx1.sinaimg.cn/a.png' },
                        ],
                    },
                },
            }),
        )
        const cache = createWeiboCache(createUri(STORAGE_ROOT))
        const entry = await cache.readHotRank(ACCOUNT)
        expect(entry?.data.items).toEqual([
            {
                rank: 1,
                title: '合法条目',
                description: null,
                iconUrl: null,
                iconDesc: null,
                iconDescColor: null,
            },
            {
                rank: 3,
                title: '非图床图标',
                description: null,
                iconUrl: null,
                iconDesc: null,
                iconDescColor: null,
            },
        ])
    })

    it('全部条目非法时按未命中处理，不返回空榜', async () => {
        setFileContent(
            CACHE_PATH,
            rawFile({
                hotRank: {
                    fetchedAt: '2026-11-20T10:00:00.000Z',
                    data: { fetchedAt: '2026-11-20T10:00:00.000Z', items: [{ rank: 0, title: '' }] },
                },
            }),
        )
        const cache = createWeiboCache(createUri(STORAGE_ROOT))
        expect(await cache.readHotRank(ACCOUNT)).toBeNull()
    })

    it('表情条目缺图或非图床地址时丢弃', async () => {
        setFileContent(
            CACHE_PATH,
            rawFile({
                emoticons: {
                    fetchedAt: '2026-11-20T11:00:00.000Z',
                    data: {
                        fetchedAt: '2026-11-20T11:00:00.000Z',
                        emoticons: [
                            { phrase: '[好]', url: 'https://face.t.sinajs.cn/a.png', category: '默认' },
                            { phrase: '[坏]', url: 'https://evil.example/a.png', category: '默认' },
                            { phrase: '', url: 'https://face.t.sinajs.cn/b.png', category: '默认' },
                        ],
                    },
                },
            }),
        )
        const cache = createWeiboCache(createUri(STORAGE_ROOT))
        const entry = await cache.readEmoticons(ACCOUNT)
        expect(entry?.data.emoticons).toEqual([
            { phrase: '[好]', url: 'https://face.t.sinajs.cn/a.png', category: '默认' },
        ])
    })

    it('三个来源并发写入互不覆盖', async () => {
        const cache = createWeiboCache(createUri(STORAGE_ROOT))
        await Promise.all([
            cache.write('groups', ACCOUNT, groupsResult(), '2026-11-20T10:00:00.000Z'),
            cache.write('hotRank', ACCOUNT, hotRankResult(), hotRankResult().fetchedAt),
            cache.write('emoticons', ACCOUNT, emoticonsResult(), emoticonsResult().fetchedAt),
        ])
        expect((await cache.readGroups(ACCOUNT))?.data).toEqual(groupsResult())
        expect((await cache.readHotRank(ACCOUNT))?.data).toEqual(hotRankResult())
        expect((await cache.readEmoticons(ACCOUNT))?.data).toEqual(emoticonsResult())
    })

    it('换账号写入时整份重建，旧账号条目不再可读', async () => {
        const cache = createWeiboCache(createUri(STORAGE_ROOT))
        await cache.write('groups', ACCOUNT, groupsResult(), '2026-11-20T10:00:00.000Z')
        await cache.write('hotRank', OTHER_ACCOUNT, hotRankResult(), hotRankResult().fetchedAt)

        expect(await cache.readGroups(ACCOUNT)).toBeNull()
        expect(await cache.readGroups(OTHER_ACCOUNT)).toBeNull()
        expect((await cache.readHotRank(OTHER_ACCOUNT))?.data.items).toHaveLength(1)
    })

    it('预热时刻按账号隔离', async () => {
        const cache = createWeiboCache(createUri(STORAGE_ROOT), (): Date => new Date('2026-11-20T12:00:00.000Z'))
        await cache.markWarmed(ACCOUNT)
        expect(await cache.readWarmedAt(ACCOUNT)).toBe('2026-11-20T12:00:00.000Z')
        expect(await cache.readWarmedAt(OTHER_ACCOUNT)).toBeNull()
    })

    it('账号信息写入后可读回，换号或昵称缺失都按未命中处理', async () => {
        const cache = createWeiboCache(createUri(STORAGE_ROOT))
        const profile: WeiboProfile = {
            id: '6305885570',
            name: '测试账号',
            avatarUrl: 'https://tvax1.sinaimg.cn/avatar.jpg',
            isVerified: true,
            description: '简介',
            followersCount: 128,
            friendsCount: 32,
            statusesCount: 9,
        }
        await cache.write('profile', ACCOUNT, profile, '2026-11-20T12:00:00.000Z')

        expect((await cache.readProfile(ACCOUNT))?.data).toEqual(profile)
        expect(await cache.readProfile(OTHER_ACCOUNT)).toBeNull()

        setFileContent(
            CACHE_PATH,
            rawFile({
                profile: {
                    fetchedAt: '2026-11-20T12:00:00.000Z',
                    data: { id: '6305885570', name: '  ', avatarUrl: '' },
                },
            }),
        )
        expect(await cache.readProfile(ACCOUNT)).toBeNull()
    })

    it('clear 删除整个缓存文件', async () => {
        const cache = createWeiboCache(createUri(STORAGE_ROOT))
        await cache.write('groups', ACCOUNT, groupsResult(), '2026-11-20T10:00:00.000Z')
        await cache.clear()

        expect(readDeletedPaths()).toContain(CACHE_PATH)
        expect(await cache.readGroups(ACCOUNT)).toBeNull()
    })
})
