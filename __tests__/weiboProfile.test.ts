/**
 * 微博账号信息与头像链路的单元测试：覆盖地址构造、字段归一化、白名单收窄与路由缓存行为。
 * 全部不触网：取数、缓存与头像网关都由用例注入替身，路由只做方法分发与缓存编排。
 */
import { describe, expect, it } from 'vitest'
import type { WeiboGroupItem, WeiboGroupsResult, WeiboProfile } from '@shared/types/weibo'
import type { WeiboAvatarGateway } from '../src/modules/weibo/media/avatar'
import type { WeiboCookieStore } from '../src/modules/weibo/store/credential'
import type { WeiboCache, WeiboCacheEntry } from '../src/modules/weibo/store/metadataCache'
import { buildProfileUrl, normalizeWeiboProfile } from '../src/modules/weibo/api/profile'
import { WeiboRoutes } from '../src/modules/weibo/protocol/routes'

const ACCOUNT_COOKIE = 'SUB=abc123; SUBP=def456'

/** 已配置凭证的 Cookie 存取器 */
const configuredCookieStore: WeiboCookieStore = {
    read: () => Promise.resolve(ACCOUNT_COOKIE),
    write: () => Promise.resolve(),
    remove: () => Promise.resolve(),
    readSavedAt: () => Promise.resolve(undefined),
    writeSavedAt: () => Promise.resolve(),
    removeSavedAt: () => Promise.resolve(),
}

/** 一份可用的账号信息 */
function profileFixture(overrides: Partial<WeiboProfile> = {}): WeiboProfile {
    return {
        id: '6305885570',
        name: '测试账号',
        avatarUrl: 'https://tvax1.sinaimg.cn/avatar.jpg',
        isVerified: true,
        description: '简介',
        followersCount: 128,
        friendsCount: 32,
        statusesCount: 9,
        ...overrides,
    }
}

/** 分组结果：uid 为 null 时模拟上游没给账号 id */
function groupsFixture(uid: string | null): WeiboGroupsResult {
    const item: WeiboGroupItem = { gid: '10001', title: '最新微博', uid: uid ?? '', isCustom: false }
    return { defaultGroups: [item], myGroups: [], hotChannels: [], timelineListId: '10001', uid }
}

/** 缓存替身：记录写入的键与清除次数，其余读一律未命中 */
function createCache(seed: { profile?: WeiboProfile; groups?: WeiboGroupsResult } = {}): {
    cache: WeiboCache
    writes: string[]
    state: { cleared: number }
} {
    const writes: string[] = []
    const state = { cleared: 0 }
    const entry = <T>(data: T): WeiboCacheEntry<T> => ({ data, fetchedAt: '2026-11-20T10:00:00.000Z' })
    const cache: WeiboCache = {
        readGroups: () => Promise.resolve(seed.groups === undefined ? null : entry(seed.groups)),
        readHotRank: () => Promise.resolve(null),
        readEmoticons: () => Promise.resolve(null),
        readProfile: () => Promise.resolve(seed.profile === undefined ? null : entry(seed.profile)),
        write: (key: string): Promise<void> => {
            writes.push(key)
            return Promise.resolve()
        },
        readWarmedAt: () => Promise.resolve(null),
        markWarmed: () => Promise.resolve(),
        clear: (): Promise<void> => {
            state.cleared += 1
            return Promise.resolve()
        },
    }
    return { cache, writes, state }
}

/** 头像网关替身：记录下载地址与清除次数 */
function createAvatar(initial: string | null): {
    avatar: WeiboAvatarGateway
    downloads: string[]
    state: { cleared: number; readCalls: number }
} {
    const downloads: string[] = []
    const state = { cleared: 0, readCalls: 0 }
    const avatar: WeiboAvatarGateway = {
        read: (): Promise<string | null> => {
            state.readCalls += 1
            return Promise.resolve(initial)
        },
        download: (imageUrl: string): Promise<string | null> => {
            downloads.push(imageUrl)
            return Promise.resolve('data:image/jpeg;base64,AAAA')
        },
        clear: (): Promise<void> => {
            state.cleared += 1
            return Promise.resolve()
        },
    }
    return { avatar, downloads, state }
}

describe('webProfile', () => {
    it('地址带上 uid 与 scene=profile', () => {
        const url = new URL(buildProfileUrl('6305885570'))
        expect(url.origin).toBe('https://weibo.com')
        expect(url.pathname).toBe('/ajax/profile/info')
        expect(url.searchParams.get('uid')).toBe('6305885570')
        expect(url.searchParams.get('scene')).toBe('profile')
    })

    it('映射账号字段，头像优先 avatar_hd', () => {
        const profile = normalizeWeiboProfile({
            ok: 1,
            data: {
                user: {
                    id: 6305885570,
                    screen_name: '  测试账号 ',
                    avatar_hd: 'https://tvax1.sinaimg.cn/hd.jpg',
                    avatar_large: 'https://tvax1.sinaimg.cn/large.jpg',
                    verified: true,
                    description: '<a>简介</a>',
                    followers_count: 128,
                    friends_count: 32,
                    statuses_count: 9,
                },
            },
        })
        expect(profile).toEqual({
            id: '6305885570',
            name: '测试账号',
            avatarUrl: 'https://tvax1.sinaimg.cn/hd.jpg',
            isVerified: true,
            description: '简介',
            followersCount: 128,
            friendsCount: 32,
            statusesCount: 9,
        })
    })

    it('非图床头像地址置空而不是原样保留', () => {
        const profile = normalizeWeiboProfile({
            data: { user: { id: 1, screen_name: '某账号', avatar_hd: 'https://evil.example/a.png' } },
        })
        expect(profile?.avatarUrl).toBe('')
    })

    it('缺 user、缺 id 或缺昵称都视为不可用', () => {
        expect(normalizeWeiboProfile({ data: {} })).toBeNull()
        expect(normalizeWeiboProfile({ data: { user: { screen_name: '无名' } } })).toBeNull()
        expect(normalizeWeiboProfile({ data: { user: { id: 2, screen_name: '   ' } } })).toBeNull()
    })
})

describe('weibo/profile 路由', () => {
    it('缓存命中且本地头像在时零回源、零下载', async () => {
        const { cache, writes } = createCache({ profile: profileFixture() })
        const { avatar, downloads, state } = createAvatar('data:image/jpeg;base64,AAAA')
        let fetches = 0
        const routes = new WeiboRoutes({
            cookieStore: configuredCookieStore,
            cache,
            avatar,
            fetchProfile: (): Promise<WeiboProfile> => {
                fetches += 1
                return Promise.resolve(profileFixture())
            },
        })

        const result = await routes.handle('weibo/profile', undefined)
        expect(result).toEqual({ profile: profileFixture(), avatarDataUrl: 'data:image/jpeg;base64,AAAA' })
        expect(fetches).toBe(0)
        expect(downloads).toEqual([])
        expect(writes).toEqual([])
        expect(state.readCalls).toBe(1)
    })

    it('缓存命中但头像文件缺失时只重下头像，不重取资料', async () => {
        const { cache } = createCache({ profile: profileFixture() })
        const { avatar, downloads } = createAvatar(null)
        let fetches = 0
        const routes = new WeiboRoutes({
            cookieStore: configuredCookieStore,
            cache,
            avatar,
            fetchProfile: (): Promise<WeiboProfile> => {
                fetches += 1
                return Promise.resolve(profileFixture())
            },
        })

        const result = await routes.handle('weibo/profile', undefined)
        expect(fetches).toBe(0)
        expect(downloads).toEqual([profileFixture().avatarUrl])
        expect(result).toMatchObject({ profile: profileFixture(), avatarDataUrl: 'data:image/jpeg;base64,AAAA' })
    })

    it('refresh 为真时强制回源并写缓存，顺带补齐分组', async () => {
        const { cache, writes } = createCache({ profile: profileFixture() })
        const { avatar, downloads } = createAvatar(null)
        const routes = new WeiboRoutes({
            cookieStore: configuredCookieStore,
            cache,
            avatar,
            fetchGroups: (): Promise<WeiboGroupsResult> => Promise.resolve(groupsFixture('6305885570')),
            fetchProfile: (options): Promise<WeiboProfile> => Promise.resolve(profileFixture({ id: options.uid })),
        })

        const result = await routes.handle('weibo/profile', { refresh: true })
        expect(writes).toEqual(['groups', 'profile'])
        expect(downloads).toHaveLength(1)
        expect(result).toMatchObject({ profile: { id: '6305885570' } })
    })

    it('分组里没有 uid 时明确报错，而不是拼一个空地址', async () => {
        const { cache } = createCache()
        const routes = new WeiboRoutes({
            cookieStore: configuredCookieStore,
            cache,
            fetchGroups: (): Promise<WeiboGroupsResult> => Promise.resolve(groupsFixture(null)),
            fetchProfile: (): Promise<WeiboProfile> => Promise.resolve(profileFixture()),
        })

        await expect(routes.handle('weibo/profile', undefined)).rejects.toThrowError(/uid/u)
    })

    it('清除凭证时同时清缓存与本地头像', async () => {
        const { cache, state } = createCache()
        const { avatar, state: avatarState } = createAvatar(null)
        const routes = new WeiboRoutes({ cookieStore: configuredCookieStore, cache, avatar })

        await routes.handle('weibo/credential/clear', undefined)
        expect(state.cleared).toBe(1)
        expect(avatarState.cleared).toBe(1)
    })
})
