/**
 * 微博表情配置的单元测试：覆盖 ZH_CN 分类提取、类内去重与取数地址。
 * 全部不触网：requestJson 由用例注入假响应，fetch 不参与断言。
 */
import { describe, expect, it } from 'vitest'
import type { WeiboJsonQuery } from '../src/modules/weibo/webClient'
import { extractWeiboEmoticons, fetchWeiboEmoticons } from '../src/modules/weibo/webEmoticons'

/** 表情图床直链前缀：与上游返回同形 */
const FACE_BASE = 'https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal'

describe('extractWeiboEmoticons', () => {
    it('按 ZH_CN 的分类提取表情并回填分类名', () => {
        const emoticons = extractWeiboEmoticons({
            ok: 1,
            data: {
                emoticon: {
                    ZH_CN: {
                        PC热门表情: [
                            { phrase: '[不愧是你]', url: `${FACE_BASE}/2b/2025_ItsYou_mobile.png` },
                            { phrase: '[心]', url: `${FACE_BASE}/79/201810_xin_mobile.png` },
                        ],
                        哪吒: [{ phrase: '[哪吒]', url: 'https://face.t.sinajs.cn/emoji/pic/1.png' }],
                    },
                },
                // 别名渲染映射不参与：只在 ZH_CN 分类里的条目才是表情来源
                emoticonRender: { '[不愧是你]': 'https://face.t.sinajs.cn/emoji/pic/alias.png' },
            },
        })
        expect(emoticons.map((item) => item.category)).toEqual(['PC热门表情', 'PC热门表情', '哪吒'])
        expect(emoticons.map((item) => item.phrase)).toEqual(['[不愧是你]', '[心]', '[哪吒]'])
    })

    it('类内重复 phrase 只留首见，跨类重复保留', () => {
        const emoticons = extractWeiboEmoticons({
            ok: 1,
            data: {
                emoticon: {
                    ZH_CN: {
                        甲: [
                            { phrase: '[哈哈]', url: `${FACE_BASE}/a.gif` },
                            { phrase: '[哈哈]', url: `${FACE_BASE}/b.gif` },
                        ],
                        乙: [{ phrase: '[哈哈]', url: `${FACE_BASE}/c.gif` }],
                    },
                },
            },
        })
        expect(emoticons).toEqual([
            { phrase: '[哈哈]', url: `${FACE_BASE}/a.gif`, category: '甲' },
            { phrase: '[哈哈]', url: `${FACE_BASE}/c.gif`, category: '乙' },
        ])
    })

    it('非图床地址与缺 phrase 的条目丢弃', () => {
        const emoticons = extractWeiboEmoticons({
            ok: 1,
            data: {
                emoticon: {
                    ZH_CN: {
                        默认: [
                            { phrase: '[外链]', url: 'https://evil.example.com/a.gif' },
                            { url: `${FACE_BASE}/no-phrase.gif` },
                            { phrase: '[可用]', url: `${FACE_BASE}/ok.gif` },
                        ],
                    },
                },
            },
        })
        expect(emoticons).toEqual([{ phrase: '[可用]', url: `${FACE_BASE}/ok.gif`, category: '默认' }])
    })

    it('结构不是预期形态时返回空数组', () => {
        expect(extractWeiboEmoticons({ ok: 1, data: {} })).toEqual([])
        expect(extractWeiboEmoticons({ ok: 1, data: { emoticon: { EN_US: { 默认: [] } } } })).toEqual([])
    })
})

describe('fetchWeiboEmoticons', () => {
    it('请求 ajax/statuses/config 并回包归一化结果', async () => {
        const urls: string[] = []
        const result = await fetchWeiboEmoticons({
            cookie: 'SUB=x',
            now: (): Date => new Date('2026-11-20T00:00:00.000Z'),
            requestJson: (query: WeiboJsonQuery): Promise<{ record: Record<string, unknown>; status: number }> => {
                urls.push(query.url)
                return Promise.resolve({
                    record: {
                        ok: 1,
                        data: {
                            emoticon: { ZH_CN: { PC热门表情: [{ phrase: '[哈哈]', url: `${FACE_BASE}/1.gif` }] } },
                        },
                    },
                    status: 200,
                })
            },
        })
        expect(urls).toEqual(['https://weibo.com/ajax/statuses/config'])
        expect(result.emoticons).toHaveLength(1)
        expect(result.fetchedAt).toBe('2026-11-20T00:00:00.000Z')
    })

    it('没有可用表情时报错，并带上实际返回字段名', async () => {
        await expect(
            fetchWeiboEmoticons({
                cookie: 'SUB=x',
                requestJson: (): Promise<{ record: Record<string, unknown>; status: number }> =>
                    Promise.resolve({ record: { ok: 1, data: { emoticon: {}, emoticonRender: {} } }, status: 200 }),
            }),
        ).rejects.toThrow('返回字段：emoticon、emoticonRender')
    })
})
