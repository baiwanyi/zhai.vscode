/**
 * 微博热搜榜的单元测试：覆盖地址构造、realtime 两种层级、字段收窄与名次保持。
 * 全部不触网：requestJson 由用例注入假响应，fetch 不参与断言。
 */
import { describe, expect, it } from 'vitest'
import type { WeiboJsonQuery } from '../src/modules/weibo/webClient'
import {
    buildHotRankUrl,
    extractWeiboHotRank,
    fetchWeiboHotRank,
    normalizeHotRankColor,
} from '../src/modules/weibo/webHotRank'

describe('buildHotRankUrl', () => {
    it('使用 mine 侧栏参数，last_tab_time 取秒级时间戳', () => {
        const url = new URL(buildHotRankUrl(new Date('2026-11-20T00:00:00.000Z')))
        expect(url.pathname).toBe('/ajax/side/bandUnified')
        expect(url.searchParams.get('type')).toBe('mine')
        expect(url.searchParams.get('last_tab')).toBe('mine')
        expect(url.searchParams.get('last_tab_time')).toBe('1795132800')
    })
})

describe('extractWeiboHotRank', () => {
    it('映射 realtime 条目：标题、标记、图标与徽标色', () => {
        const items = extractWeiboHotRank({
            ok: 1,
            data: {
                realtime: [
                    {
                        note: '热搜一号',
                        description: '热',
                        icon_url: 'https://face.t.sinajs.cn/a.png',
                        icon_desc: '新',
                        icon_desc_color: '#f26d5f',
                    },
                    { word: '热搜二号', icon_url: 'https://evil.example.com/x.png', icon_desc_color: 'red' },
                    { title: '' },
                ],
            },
        })
        expect(items).toHaveLength(2)
        expect(items[0]).toEqual({
            rank: 1,
            title: '热搜一号',
            description: '热',
            iconUrl: 'https://face.t.sinajs.cn/a.png',
            iconDesc: '新',
            iconDescColor: '#f26d5f',
        })
        // 非图床域名与非法颜色都归一为 null；被丢弃的第三条不影响已有序号
        expect(items[1]?.iconUrl).toBeNull()
        expect(items[1]?.iconDescColor).toBeNull()
        expect(items.map((item) => item.rank)).toEqual([1, 2])
    })

    it('按 realpos 取名次、过滤广告与「商」「上新」推广位，icon 字段作为图标地址并回落 label_name', () => {
        const items = extractWeiboHotRank({
            ok: 1,
            data: {
                realtime: [
                    {
                        note: '第一条',
                        word_scheme: '#第一条#',
                        realpos: 1,
                        rank: 0,
                        icon_desc: '热',
                        icon_desc_color: '#ff9406',
                        icon: 'https://simg.s.weibo.com/moter/flags/2_0.png',
                    },
                    {
                        note: '广告位',
                        is_ad: 1,
                        rank: 5,
                        icon_desc: '辟谣',
                        icon: 'https://simg.s.weibo.com/imgtool/x.png',
                    },
                    { note: '第二条', realpos: 2, rank: 1, label_name: '新', icon_desc_color: '#ff3852' },
                    // 商业推广位不带 is_ad，只靠 icon_desc 标记；不能进榜也不能占名次
                    { note: '商业推广位', realpos: 3, rank: 2, icon_desc: '商' },
                    // 品牌活动位同样只打标记，label_name 兜底也要识别
                    { note: '上新活动位', realpos: 4, rank: 3, label_name: '上新' },
                ],
            },
        })
        expect(items.map((item) => item.rank)).toEqual([1, 2])
        expect(items.map((item) => item.title)).toEqual(['#第一条#', '第二条'])
        // 标题按网页端口径取 word_scheme（带话题符号）
        expect(items[0]?.title).toBe('#第一条#')
        expect(items[0]?.iconUrl).toBe('https://simg.s.weibo.com/moter/flags/2_0.png')
        expect(items[0]?.iconDesc).toBe('热')
        // 没有 icon_desc 时用 label_name 兜底
        expect(items[1]?.iconDesc).toBe('新')
        expect(items[1]?.iconDescColor).toBe('#ff3852')
    })

    it('兼容 realtime 嵌在 band_list 分区里的形态', () => {
        const items = extractWeiboHotRank({
            ok: 1,
            data: {
                band_list: [{ title: '实时热搜', realtime: [{ note: '分区热搜', icon_desc: '沸' }] }],
            },
        })
        expect(items).toHaveLength(1)
        expect(items[0]?.title).toBe('分区热搜')
        expect(items[0]?.rank).toBe(1)
    })

    it('没有 realtime 时返回空数组', () => {
        expect(extractWeiboHotRank({ ok: 1, data: {} })).toEqual([])
    })
})

describe('normalizeHotRankColor', () => {
    it('只放行 hex 与 rgb 字面量', () => {
        expect(normalizeHotRankColor('#f26d5f')).toBe('#f26d5f')
        expect(normalizeHotRankColor('#abc')).toBe('#abc')
        expect(normalizeHotRankColor('rgb(242, 109, 95)')).toBe('rgb(242, 109, 95)')
        expect(normalizeHotRankColor('red')).toBeNull()
        expect(normalizeHotRankColor('javascript:alert(1)')).toBeNull()
    })
})

describe('fetchWeiboHotRank', () => {
    it('按接口地址取数并回包归一化结果', async () => {
        const urls: string[] = []
        const result = await fetchWeiboHotRank({
            cookie: 'SUB=x',
            now: (): Date => new Date('2026-11-20T00:00:00.000Z'),
            requestJson: (query: WeiboJsonQuery): Promise<{ record: Record<string, unknown>; status: number }> => {
                urls.push(query.url)
                return Promise.resolve({ record: { ok: 1, data: { realtime: [{ note: '热搜' }] } }, status: 200 })
            },
        })
        expect(urls).toHaveLength(1)
        expect(urls[0]?.startsWith('https://weibo.com/ajax/side/bandUnified?')).toBe(true)
        expect(result.items).toHaveLength(1)
        expect(result.fetchedAt).toBe('2026-11-20T00:00:00.000Z')
    })

    it('没有可用条目时按结构异常报错', async () => {
        await expect(
            fetchWeiboHotRank({
                cookie: 'SUB=x',
                requestJson: (): Promise<{ record: Record<string, unknown>; status: number }> =>
                    Promise.resolve({ record: { ok: 1, data: { realtime: [] } }, status: 200 }),
            }),
        ).rejects.toThrow('没有可用的热搜条目')
    })
})
