/**
 * 我的赞取数单元测试：覆盖地址构造、两种列表层级、总数与是否还有下一页。
 * 全部不触网：requestJson 由用例注入假响应，fetch 不参与任何断言。
 * 断言只针对可观察结果（URL 查询参数、归一化后的帖子与分页标记）。
 */
import { describe, expect, it } from 'vitest'
import type { WeiboJsonQuery } from '../src/modules/weibo/webClient'
import { buildLikesUrl, fetchWeiboLikes } from '../src/modules/weibo/webLikes'

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

/** 固定时刻：保证 fetchedAt 可断言 */
const FIXED_NOW = new Date('2026-11-20T08:00:00.000Z')

describe('buildLikesUrl', () => {
    it('固定 likelist 端点，带 uid / page / with_total', () => {
        const url = new URL(buildLikesUrl('6305885570', 2))
        expect(url.pathname).toBe('/ajax/statuses/likelist')
        expect(url.searchParams.get('uid')).toBe('6305885570')
        expect(url.searchParams.get('page')).toBe('2')
        expect(url.searchParams.get('with_total')).toBe('true')
    })
})

describe('fetchWeiboLikes', () => {
    it('解析 list[].mblog，并按总数判断还有下一页', async () => {
        const queries: WeiboJsonQuery[] = []
        const result = await fetchWeiboLikes({
            cookie: 'SUB=test',
            uid: '6305885570',
            requestJson: (query) => {
                queries.push(query)
                return Promise.resolve({
                    record: {
                        ok: 1,
                        data: { total_number: 45, list: [{ mblog: rawStatus(1) }, { mblog: rawStatus(2) }] },
                    },
                    status: 200,
                })
            },
            now: () => FIXED_NOW,
        })
        expect(queries[0]?.url).toContain('/ajax/statuses/likelist')
        expect(result.posts.map((post) => post.id)).toEqual(['1', '2'])
        expect(result.page).toBe(1)
        expect(result.totalNumber).toBe(45)
        expect(result.hasMore).toBe(true)
        expect(result.fetchedAt).toBe('2026-11-20T08:00:00.000Z')
    })

    it('兼容 statuses 层级；总数缺失时本页不满 20 条即视为到底', async () => {
        const result = await fetchWeiboLikes({
            cookie: 'SUB=test',
            uid: '6305885570',
            requestJson: () =>
                Promise.resolve({
                    record: { ok: 1, statuses: [rawStatus(11), rawStatus(12)] },
                    status: 200,
                }),
            now: () => FIXED_NOW,
        })
        expect(result.posts).toHaveLength(2)
        expect(result.totalNumber).toBeNull()
        expect(result.hasMore).toBe(false)
    })

    it('非法页码回到第一页，缺 id 的条目丢弃且不发请求多一次', async () => {
        const queries: WeiboJsonQuery[] = []
        const result = await fetchWeiboLikes({
            cookie: 'SUB=test',
            uid: '6305885570',
            page: 0,
            requestJson: (query) => {
                queries.push(query)
                return Promise.resolve({
                    record: { ok: 1, data: { list: [{ mblog: rawStatus(21) }, { mblog: { text: '无 id' } }] } },
                    status: 200,
                })
            },
            now: () => FIXED_NOW,
        })
        expect(new URL(queries[0]?.url ?? '').searchParams.get('page')).toBe('1')
        expect(result.posts.map((post) => post.id)).toEqual(['21'])
        expect(result.droppedDuplicates).toBe(0)
    })
})
