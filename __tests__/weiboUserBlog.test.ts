/**
 * 他人主页取数单元测试：覆盖资料地址、列表地址、两次请求的顺序与归一化结果。
 * 全部不触网：requestJson 由用例注入假响应，fetch 不参与任何断言。
 * 断言只针对可观察结果（URL 查询参数、归一化后的用户资料、帖子与分页标记）。
 */
import { describe, expect, it } from 'vitest'
import type { WeiboJsonQuery } from '../src/modules/weibo/transport/httpClient'
import { buildUserInfoUrl } from '../src/modules/weibo/api/profile'
import { buildUserBlogUrl, fetchWeiboUserBlog } from '../src/modules/weibo/api/userBlog'
import { WeiboWebError } from '../src/modules/weibo/transport/httpClient'

/** 构造一份最小可用的上游用户资料 */
function rawUser(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 2129704452,
        idstr: '2129704452',
        screen_name: '小太阳毕雪',
        avatar_hd: 'https://tvax2.sinaimg.cn/crop.0.0.1080.1080.1024/abc.jpg',
        cover_image_phone: 'https://wx1.sinaimg.cn/cover-a.jpg;https://wx3.sinaimg.cn/cover-b.jpg',
        verified: false,
        description: '欢迎来到我地盘',
        location: '北京 朝阳区',
        gender: 'f',
        followers_count: 129574,
        friends_count: 99,
        statuses_count: 420,
        ...overrides,
    }
}

/** 构造一条最小可用的上游微博（mymblog 把微博对象直接放进 list） */
function rawStatus(id: number): Record<string, unknown> {
    return {
        id,
        idstr: String(id),
        mblogid: `M${String(id)}`,
        text_raw: `正文 ${String(id)}`,
        created_at: 'Sat Nov 14 15:53:18 +0800 2026',
        reposts_count: 0,
        comments_count: 0,
        attitudes_count: 0,
        user: { id: 2129704452, screen_name: '小太阳毕雪' },
    }
}

/** 固定时刻：保证 fetchedAt 可断言 */
const FIXED_NOW = new Date('2026-11-22T08:00:00.000Z')

describe('buildUserInfoUrl', () => {
    it('有 uid 时走 uid，并固定 scene=profile', () => {
        const url = new URL(buildUserInfoUrl({ uid: '2129704452' }))
        expect(url.pathname).toBe('/ajax/profile/info')
        expect(url.searchParams.get('uid')).toBe('2129704452')
        expect(url.searchParams.get('scene')).toBe('profile')
        expect(url.searchParams.get('screen_name')).toBeNull()
    })

    it('只有昵称时走 screen_name，不拼 uid', () => {
        const url = new URL(buildUserInfoUrl({ screenName: '小太阳毕雪' }))
        expect(url.searchParams.get('screen_name')).toBe('小太阳毕雪')
        expect(url.searchParams.get('uid')).toBeNull()
    })
})

describe('buildUserBlogUrl', () => {
    it('固定 mymblog 端点，带 uid / page / feature', () => {
        const url = new URL(buildUserBlogUrl('2129704452', 2))
        expect(url.pathname).toBe('/ajax/statuses/mymblog')
        expect(url.searchParams.get('uid')).toBe('2129704452')
        expect(url.searchParams.get('page')).toBe('2')
        expect(url.searchParams.get('feature')).toBe('0')
    })
})

describe('fetchWeiboUserBlog', () => {
    it('按 uid 取资料与列表，资料补齐封面首张与性别', async () => {
        const queries: WeiboJsonQuery[] = []
        const result = await fetchWeiboUserBlog({
            cookie: 'SUB=test',
            uid: '2129704452',
            requestJson: (query) => {
                queries.push(query)
                const isInfo = query.url.includes('/ajax/profile/info')
                return Promise.resolve({
                    record: isInfo
                        ? { ok: 1, data: { user: rawUser() } }
                        : { ok: 1, data: { total: 45, list: [rawStatus(1), rawStatus(2)] } },
                    status: 200,
                })
            },
            now: () => FIXED_NOW,
        })
        expect(queries.map((query) => new URL(query.url).pathname)).toEqual([
            '/ajax/profile/info',
            '/ajax/statuses/mymblog',
        ])
        expect(result.user.id).toBe('2129704452')
        expect(result.user.name).toBe('小太阳毕雪')
        expect(result.user.coverUrl).toBe('https://wx1.sinaimg.cn/cover-a.jpg')
        expect(result.user.gender).toBe('f')
        expect(result.posts.map((post) => post.id)).toEqual(['1', '2'])
        expect(result.page).toBe(1)
        expect(result.total).toBe(45)
        expect(result.hasMore).toBe(true)
        expect(result.fetchedAt).toBe('2026-11-22T08:00:00.000Z')
    })

    it('昵称查询先用回包 uid 取列表，页码非法回落到第一页', async () => {
        const queries: WeiboJsonQuery[] = []
        const result = await fetchWeiboUserBlog({
            cookie: 'SUB=test',
            screenName: '小太阳毕雪',
            page: 0,
            requestJson: (query) => {
                queries.push(query)
                const isInfo = query.url.includes('/ajax/profile/info')
                return Promise.resolve({
                    record: isInfo ? { ok: 1, data: { user: rawUser() } } : { ok: 1, data: { total: 20, list: [] } },
                    status: 200,
                })
            },
            now: () => FIXED_NOW,
        })
        const listUrl = new URL(queries[1]?.url ?? '')
        expect(new URL(queries[0]?.url ?? '').searchParams.get('screen_name')).toBe('小太阳毕雪')
        expect(listUrl.searchParams.get('uid')).toBe('2129704452')
        expect(listUrl.searchParams.get('page')).toBe('1')
        expect(result.page).toBe(1)
        expect(result.posts).toHaveLength(0)
        expect(result.hasMore).toBe(false)
    })

    it('资料结构异常直接报错，不再请求列表', async () => {
        const queries: WeiboJsonQuery[] = []
        await expect(
            fetchWeiboUserBlog({
                cookie: 'SUB=test',
                uid: '2129704452',
                requestJson: (query) => {
                    queries.push(query)
                    return Promise.resolve({ record: { ok: 1, data: {} }, status: 200 })
                },
                now: () => FIXED_NOW,
            }),
        ).rejects.toBeInstanceOf(WeiboWebError)
        expect(queries).toHaveLength(1)
    })
})
