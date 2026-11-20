/**
 * 微博信息流与分组的单元测试：覆盖三种端点的地址构造、分组归一化与卡片流提取。
 * 全部不触网：requestJson 由用例注入假响应，fetch 不参与任何断言。
 * 断言只针对可观察结果（URL 查询参数、归一化后的帖子与游标），不绑定上游其余字段。
 */
import { describe, expect, it } from 'vitest'
import type { WeiboJsonQuery } from '../src/modules/weibo/webClient'
import { buildFeedUrl, fetchWeiboFeed, fetchWeiboGroups } from '../src/modules/weibo/webFeed'

/** 构造一条最小可用的上游微博 */
function rawStatus(id: number): Record<string, unknown> {
    return {
        id,
        idstr: String(id),
        mblogid: `M${String(id)}`,
        text_raw: `正文 ${String(id)}`,
        created_at: 'Wed Nov 19 10:00:00 +0800 2026',
        reposts_count: 0,
        comments_count: 0,
        attitudes_count: 0,
        user: { id: 9001, screen_name: '测试作者' },
    }
}

/** 分组接口的最小响应：默认分组里含「最新微博」，我的分组里含一个自建分组 */
const GROUPS_RECORD: Record<string, unknown> = {
    ok: 1,
    groups: [
        {
            title: '默认分组',
            group: [
                { gid: '100016305885570', uid: '6305885570', title: '全部关注', sysgroup: 2 },
                { gid: '110006305885570', uid: '6305885570', title: '最新微博', sysgroup: 2 },
            ],
        },
        {
            title: '我的分组',
            group: [{ gid: '5225046125581012', uid: 6305885570, title: '颜值', sysgroup: 0 }],
        },
        { title: '订阅分组', group: [] },
    ],
}

describe('buildFeedUrl', () => {
    it('时间线带 list_id、fid 与 refresh=4', () => {
        const url = new URL(
            buildFeedUrl({ source: 'timeline', listId: '110006305885570', sinceId: null, maxId: null, count: 25 }),
        )
        expect(url.pathname).toBe('/ajax/feed/friendstimeline')
        expect(url.searchParams.get('list_id')).toBe('110006305885570')
        expect(url.searchParams.get('fid')).toBe('110006305885570')
        expect(url.searchParams.get('refresh')).toBe('4')
        expect(url.searchParams.get('since_id')).toBe('0')
        expect(url.searchParams.get('count')).toBe('25')
    })

    it('热门固定频道参数，翻页只带 max_id', () => {
        const url = new URL(
            buildFeedUrl({ source: 'hot', listId: '102803', sinceId: null, maxId: '5200000000000001', count: 10 }),
        )
        expect(url.pathname).toBe('/ajax/feed/hottimeline')
        expect(url.searchParams.get('group_id')).toBe('102803')
        expect(url.searchParams.get('containerid')).toBe('102803')
        expect(url.searchParams.get('extparam')).toBe('discover|new_feed')
        expect(url.searchParams.get('refresh')).toBe('0')
        expect(url.searchParams.get('max_id')).toBe('5200000000000001')
        expect(url.searchParams.has('since_id')).toBe(false)
        expect(url.searchParams.get('count')).toBe('10')
    })

    it('热门按频道传参：containerid 取 allGroups 给出的值，refresh 统一按首屏取 0', () => {
        const realtime = new URL(
            buildFeedUrl({
                source: 'hot',
                listId: '102803600343',
                sinceId: null,
                maxId: null,
                count: 10,
                hotChannel: { gid: '102803600343', title: '实时', containerId: '102803_ctg1_600343_-_ctg1_600343' },
            }),
        )
        expect(realtime.searchParams.get('group_id')).toBe('102803600343')
        expect(realtime.searchParams.get('containerid')).toBe('102803_ctg1_600343_-_ctg1_600343')
        expect(realtime.searchParams.get('refresh')).toBe('0')
    })

    it('热门缺频道参数时按 gid 兜底 containerid', () => {
        const url = new URL(
            buildFeedUrl({ source: 'hot', listId: '1028039999', sinceId: null, maxId: null, count: 10 }),
        )
        expect(url.searchParams.get('group_id')).toBe('1028039999')
        expect(url.searchParams.get('containerid')).toBe('1028039999')
    })

    it('分组带 fast_refresh=1，条数夹取到 [1, 50]', () => {
        const url = new URL(
            buildFeedUrl({ source: 'group', listId: '5225046125581012', sinceId: null, maxId: null, count: 999 }),
        )
        expect(url.pathname).toBe('/ajax/feed/groupstimeline')
        expect(url.searchParams.get('list_id')).toBe('5225046125581012')
        expect(url.searchParams.get('fast_refresh')).toBe('1')
        expect(url.searchParams.get('count')).toBe('50')
    })
})

describe('fetchWeiboGroups', () => {
    it('按标题取默认分组与我的分组，并算出时间线的 list_id', async () => {
        const result = await fetchWeiboGroups({
            cookie: 'SUB=x',
            requestJson: (): Promise<{ record: Record<string, unknown>; status: number }> =>
                Promise.resolve({ record: GROUPS_RECORD, status: 200 }),
        })
        expect(result.defaultGroups).toHaveLength(2)
        expect(result.myGroups).toHaveLength(1)
        expect(result.myGroups[0]?.title).toBe('颜值')
        expect(result.myGroups[0]?.isCustom).toBe(true)
        expect(result.timelineListId).toBe('110006305885570')
        expect(result.uid).toBe('6305885570')
    })

    it('groups 缺失时按结构异常报错', async () => {
        await expect(
            fetchWeiboGroups({
                cookie: 'SUB=x',
                requestJson: (): Promise<{ record: Record<string, unknown>; status: number }> =>
                    Promise.resolve({ record: { ok: 1 }, status: 200 }),
            }),
        ).rejects.toThrow('groups 不是数组')
    })

    it('热门频道从「我的频道 / 频道推荐」合并去重，containerid 缺失时按 gid 兜底', async () => {
        const result = await fetchWeiboGroups({
            cookie: 'SUB=x',
            requestJson: (): Promise<{ record: Record<string, unknown>; status: number }> =>
                Promise.resolve({
                    record: {
                        ok: 1,
                        groups: [
                            { title: '默认分组', group: [{ gid: '110006305885570', title: '最新微博' }] },
                            { title: '我的分组', group: [] },
                            {
                                title: '我的频道',
                                group: [
                                    { gid: '102803', title: '热门', containerid: '102803' },
                                    { gid: '1028032222', title: '同城', containerid: '102803_2222' },
                                    // 与频道推荐重复：按 gid 去重后只保留先出现的一条
                                    { gid: '1028033288', title: '电影', containerid: '102803_ctg1_3288' },
                                ],
                            },
                            {
                                title: '频道推荐',
                                group: [
                                    { gid: '1028033288', title: '电影', containerid: '102803_ctg1_3288' },
                                    // 没有 containerid：按 gid 兜底，且不能因缺字段被丢弃
                                    { gid: '1028039999', title: '小时榜' },
                                ],
                            },
                        ],
                    },
                    status: 200,
                }),
        })
        expect(result.hotChannels.map((channel) => channel.gid)).toEqual([
            '102803',
            '1028032222',
            '1028033288',
            '1028039999',
        ])
        expect(result.hotChannels[1]?.containerId).toBe('102803_2222')
        expect(result.hotChannels[3]?.containerId).toBe('1028039999')
    })
})

describe('fetchWeiboFeed', () => {
    it('热门从 data.cards 里取 mblog，max_id=0 视为到底', async () => {
        const urls: string[] = []
        const result = await fetchWeiboFeed({
            source: 'hot',
            listId: '102803600343',
            count: 10,
            cookie: 'SUB=x',
            // 频道表由路由层传入：省掉一次 allGroups，用例也不必造分组响应
            hotChannels: [{ gid: '102803600343', title: '实时', containerId: '102803_ctg1_600343_-_ctg1_600343' }],
            now: (): Date => new Date('2026-11-20T00:00:00.000Z'),
            requestJson: (query: WeiboJsonQuery): Promise<{ record: Record<string, unknown>; status: number }> => {
                urls.push(query.url)
                return Promise.resolve({
                    record: { ok: 1, data: { cards: [{ mblog: rawStatus(1) }], max_id: '0' } },
                    status: 200,
                })
            },
        })
        expect(urls).toHaveLength(1)
        const requested = new URL(urls[0] ?? '')
        expect(requested.pathname).toBe('/ajax/feed/hottimeline')
        // containerid 用频道表给的形态，而不是 gid
        expect(requested.searchParams.get('group_id')).toBe('102803600343')
        expect(requested.searchParams.get('containerid')).toBe('102803_ctg1_600343_-_ctg1_600343')
        expect(result.posts).toHaveLength(1)
        expect(result.posts[0]?.id).toBe('1')
        expect(result.hasMore).toBe(false)
        expect(result.maxId).toBeNull()
    })

    it('时间线缺 listId 时先取默认分组，再按该 gid 请求', async () => {
        const urls: string[] = []
        await fetchWeiboFeed({
            source: 'timeline',
            cookie: 'SUB=x',
            requestJson: (query: WeiboJsonQuery): Promise<{ record: Record<string, unknown>; status: number }> => {
                urls.push(query.url)
                if (query.url.includes('allGroups')) {
                    return Promise.resolve({ record: GROUPS_RECORD, status: 200 })
                }
                return Promise.resolve({ record: { ok: 1, statuses: [rawStatus(2)], max_id: '0' }, status: 200 })
            },
        })
        expect(urls).toHaveLength(2)
        expect(new URL(urls[0] ?? '').pathname).toBe('/ajax/feed/allGroups')
        const feedUrl = new URL(urls[1] ?? '')
        expect(feedUrl.pathname).toBe('/ajax/feed/friendstimeline')
        expect(feedUrl.searchParams.get('list_id')).toBe('110006305885570')
    })

    it('分组缺少合法 listId 时直接拒绝，不发请求', async () => {
        let hasCalled = false
        await expect(
            fetchWeiboFeed({
                source: 'group',
                cookie: 'SUB=x',
                requestJson: (): Promise<{ record: Record<string, unknown>; status: number }> => {
                    hasCalled = true
                    return Promise.resolve({ record: { ok: 1, statuses: [] }, status: 200 })
                },
            }),
        ).rejects.toThrow('分组信息流缺少合法的 list_id')
        expect(hasCalled).toBe(false)
    })
})
