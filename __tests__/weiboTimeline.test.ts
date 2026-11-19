/**
 * 微博关注时间线的单元测试：覆盖请求地址构造、正文与时间归一化、分页与增量循环、Cookie 清洗。
 * 全部不触网：requestPage 由用例注入假实现，fetch 只在 buildTimelineUrl 的纯函数断言中出现。
 * 时区相关断言以 UTC 为准，构造时间串自带 +0800 偏移，避免依赖运行机器时区。
 */
import { describe, expect, it } from 'vitest'
import type { TimelinePage } from '../src/modules/weibo/webClient'
import type { WeiboCookieStore } from '../src/modules/weibo/webCredential'
import type { WeiboCommentsResult, WeiboLikeResult, WeiboLongTextResult } from '../src/shared/types/weibo'
import { buildImageDataUrl, sniffImageExtension } from '../src/modules/weibo/mediaProxy'
import { buildTimelineUrl, clampTimelineCount } from '../src/modules/weibo/webClient'
import { buildCommentsUrl, clampCommentCount, normalizeWebComment } from '../src/modules/weibo/webComments'
import { normalizeCookieInput } from '../src/modules/weibo/webCredential'
import { buildLongTextUrl, parseLongTextPayload } from '../src/modules/weibo/webLongText'
import {
    buildMiddleImageUrl,
    fetchFriendTimeline,
    isWeiboImageUrl,
    normalizeTimelinePost,
    normalizeWeiboImageUrl,
    parsePostSegments,
    parseWeiboCreatedAt,
    stripWeiboHtml,
} from '../src/modules/weibo/webTimeline'
import { WeiboRoutes } from '../src/modules/weibo/weiboRoutes'

/** 构造一条最小可用的上游微博 */
function rawStatus(id: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id,
        idstr: String(id),
        mblogid: `M${String(id)}`,
        text_raw: `正文 ${String(id)}`,
        created_at: 'Wed Nov 19 10:00:00 +0800 2026',
        source: '<a href="https://app.weibo.com/t/feed/1">iPhone客户端</a>',
        reposts_count: 2,
        comments_count: 3,
        attitudes_count: 4,
        user: { id: 9001, screen_name: '测试作者', verified: true, profile_image_url: 'https://tvax1/a.jpg' },
        ...overrides,
    }
}

describe('buildTimelineUrl', () => {
    it('首屏带 list_id、refresh=4 与 since_id=0', () => {
        const url = new URL(buildTimelineUrl({ cookie: 'SUB=x', uid: '123', count: 10 }))
        expect(url.origin).toBe('https://weibo.com')
        expect(url.pathname).toBe('/ajax/feed/unreadfriendstimeline')
        expect(url.searchParams.get('list_id')).toBe('10001123')
        expect(url.searchParams.get('refresh')).toBe('4')
        expect(url.searchParams.get('since_id')).toBe('0')
        expect(url.searchParams.get('count')).toBe('10')
        expect(url.searchParams.has('max_id')).toBe(false)
    })

    it('翻页只带 max_id，不保留 since_id', () => {
        const url = new URL(
            buildTimelineUrl({ cookie: 'SUB=x', maxId: '5200000000000001', sinceId: '5200000000000002' }),
        )
        expect(url.searchParams.get('max_id')).toBe('5200000000000001')
        expect(url.searchParams.has('since_id')).toBe(false)
    })

    it('条数夹取到 [1, 50]', () => {
        expect(clampTimelineCount(0)).toBe(1)
        expect(clampTimelineCount(999)).toBe(50)
        expect(clampTimelineCount(Number.NaN)).toBe(20)
    })
})

describe('正文与时间归一化', () => {
    it('剥标签、解实体、去零宽字符并保留换行', () => {
        const text = stripWeiboHtml('第一行<br />第二行&nbsp;&amp;&nbsp;第三行\u200b<a>#话题#</a>')
        expect(text).toBe('第一行\n第二行 & 第三行#话题#')
    })

    it('微博时间串按 +0800 折算成 UTC', () => {
        expect(parseWeiboCreatedAt('Wed Nov 19 10:00:00 +0800 2026')).toBe('2026-11-19T02:00:00.000Z')
    })

    it('无法解析的时间返回空串而不是抛错', () => {
        expect(parseWeiboCreatedAt('刚刚')).toBe('')
    })
})

describe('normalizeTimelinePost', () => {
    it('映射作者、互动数据与原文地址', () => {
        const post = normalizeTimelinePost(rawStatus(101))
        expect(post).not.toBeNull()
        expect(post).toMatchObject({
            id: '101',
            mblogid: 'M101',
            text: '正文 101',
            source: 'iPhone客户端',
            createdAt: '2026-11-19T02:00:00.000Z',
            author: { id: '9001', name: '测试作者', isVerified: true },
            metrics: { reposts: 2, comments: 3, likes: 4 },
            url: 'https://weibo.com/9001/M101',
        })
    })

    it('广告位与缺少 id 的条目直接丢弃', () => {
        expect(normalizeTimelinePost(rawStatus(102, { ad_state: 1 }))).toBeNull()
        expect(normalizeTimelinePost({ text_raw: '没有 id' })).toBeNull()
    })

    it('优先使用 text_raw，缺失时从 text 剥标签', () => {
        const post = normalizeTimelinePost(rawStatus(103, { text_raw: undefined, text: '<a>纯文本</a>' }))
        expect(post?.text).toBe('纯文本')
    })
})

describe('fetchFriendTimeline', () => {
    it('首屏按 max_id 连续翻页并在重复游标处停止', async () => {
        const pages: Record<string, TimelinePage> = {
            start: { statuses: [rawStatus(11), rawStatus(10)], sinceId: '11', maxId: '900' },
            '900': { statuses: [rawStatus(9), rawStatus(10)], sinceId: '11', maxId: null },
        }
        const calls: Array<string | null> = []
        const result = await fetchFriendTimeline({
            cookie: 'SUB=x',
            maxPages: 3,
            minIntervalMs: 0,
            now: () => new Date('2026-11-20T00:00:00.000Z'),
            requestPage: (query) => {
                calls.push(query.maxId ?? null)
                const page = pages[query.maxId ?? 'start']
                if (page === undefined) {
                    throw new Error('用例未准备该页')
                }
                return Promise.resolve(page)
            },
        })
        expect(calls).toEqual([null, '900'])
        expect(result.posts.map((post) => post.id)).toEqual(['11', '10', '9'])
        expect(result.droppedDuplicates).toBe(1)
        expect(result.pages).toBe(2)
        expect(result.maxId).toBeNull()
        expect(result.hasMore).toBe(false)
        expect(result.sinceId).toBe('11')
        expect(result.fetchedAt).toBe('2026-11-20T00:00:00.000Z')
    })

    it('增量模式只请求一页并带上 since_id', async () => {
        const queries: Array<string | null> = []
        const result = await fetchFriendTimeline({
            cookie: 'SUB=x',
            sinceId: '500',
            maxPages: 5,
            minIntervalMs: 0,
            requestPage: (query) => {
                queries.push(query.sinceId ?? null)
                return Promise.resolve({ statuses: [rawStatus(501), rawStatus(500)], sinceId: '501', maxId: '700' })
            },
        })
        expect(queries).toEqual(['500'])
        expect(result.posts.map((post) => post.id)).toEqual(['501', '500'])
        expect(result.maxId).toBeNull()
        expect(result.hasMore).toBe(false)
        expect(result.sinceId).toBe('501')
    })
})

describe('图片与表情', () => {
    it('只接受 https 且落在图床或微博域名下', () => {
        expect(isWeiboImageUrl('https://wx1.sinaimg.cn/large/a.jpg')).toBe(true)
        expect(isWeiboImageUrl('https://face.t.sinajs.cn/expression/a.png')).toBe(true)
        expect(isWeiboImageUrl('https://tvax1.weibo.com/avatar.jpg')).toBe(true)
        expect(isWeiboImageUrl('https://wx1.weibo.cn/a.jpg')).toBe(true)
        expect(isWeiboImageUrl('http://wx1.sinaimg.cn/large/a.jpg')).toBe(false)
        expect(isWeiboImageUrl('https://wx1.sinaimg.cn.evil.com/a.jpg')).toBe(false)
        expect(isWeiboImageUrl('https://weibo.com.evil.com/a.jpg')).toBe(false)
        expect(isWeiboImageUrl('javascript:alert(1)')).toBe(false)
    })

    it('协议相对地址补全为 https', () => {
        expect(normalizeWeiboImageUrl('//wx1.sinaimg.cn/large/a.jpg')).toBe('https://wx1.sinaimg.cn/large/a.jpg')
    })

    it('列表展示用 bmiddle 中图，原图地址保留', () => {
        expect(buildMiddleImageUrl('https://wx1.sinaimg.cn/large/a.jpg')).toBe('https://wx1.sinaimg.cn/bmiddle/a.jpg')
        expect(buildMiddleImageUrl('https://wx1.sinaimg.cn/mw2000/a.jpg')).toBe('https://wx1.sinaimg.cn/bmiddle/a.jpg')
        expect(buildMiddleImageUrl('https://wx1.sinaimg.cn/bmiddle/a.jpg')).toBe('https://wx1.sinaimg.cn/bmiddle/a.jpg')
        expect(buildMiddleImageUrl('https://face.t.sinajs.cn/expression/a.png')).toBe(
            'https://face.t.sinajs.cn/expression/a.png',
        )
        expect(buildMiddleImageUrl('https://tvax1.sinaimg.cn/crop.0.0.180.180.180/a.jpg')).toBe(
            'https://tvax1.sinaimg.cn/crop.0.0.180.180.180/a.jpg',
        )
    })

    it('需要登录态的下图端点改写成图床直链', () => {
        expect(normalizeWeiboImageUrl('https://weibo.com/ajax/common/download?pid=0064ZtQNabc123')).toBe(
            'https://wx1.sinaimg.cn/large/0064ZtQNabc123.jpg',
        )
        expect(normalizeWeiboImageUrl('https://weibo.com/ajax/common/download?pid=bad*pid')).toBeNull()
    })

    it('只有 pic_ids 时用 pid 拼图床直链', () => {
        const post = normalizeTimelinePost(rawStatus(106, { pic_ids: ['0064ZtQNabc123'], pic_num: 1 }))
        expect(post?.media.images).toEqual(['https://wx1.sinaimg.cn/large/0064ZtQNabc123.jpg'])
    })

    it('新版信息流从 mix_media_info 取图：直链优先，缺直链用 pid 拼', () => {
        const post = normalizeTimelinePost(
            rawStatus(107, {
                mix_media_info: {
                    items: [
                        { type: 'pic', data: { largest: { url: 'https://wx1.sinaimg.cn/large/mix1.jpg' } } },
                        { type: 'pic', id: '0064ZtQNabc999' },
                        {
                            type: 'video',
                            data: {
                                media_info: {
                                    playback_list: [{ play_info: { url: 'https://f.video.weibocdn.com/x.mp4' } }],
                                },
                            },
                        },
                    ],
                },
            }),
        )
        expect(post?.media.images).toEqual([
            'https://wx1.sinaimg.cn/large/mix1.jpg',
            'https://wx1.sinaimg.cn/large/0064ZtQNabc999.jpg',
        ])
        expect(post?.media.videoUrl).toBe('https://f.video.weibocdn.com/x.mp4')
    })

    it('正文按「文本 + 表情」顺序切段', () => {
        const segments = parsePostSegments(
            '看表情<img src="https://face.t.sinajs.cn/a.png" title="微笑">继续<a>#话题#</a>',
        )
        expect(segments).toEqual([
            { type: 'text', text: '看表情' },
            { type: 'emoji', name: '微笑', url: 'https://face.t.sinajs.cn/a.png' },
            { type: 'text', text: '继续#话题#' },
        ])
    })

    it('非图床的表情图降级成 [名称] 文本，不丢信息', () => {
        expect(parsePostSegments('前<img src="https://evil.example.com/a.png" title="doge">后')).toEqual([
            { type: 'text', text: '前[doge]后' },
        ])
    })

    it('头像与配图只保留图床地址', () => {
        const post = normalizeTimelinePost(
            rawStatus(104, {
                text: '看表情<img src="https://face.t.sinajs.cn/a.png" title="微笑">继续',
                pic_infos: {
                    p1: { largest: { url: 'https://wx1.sinaimg.cn/large/a.jpg' } },
                    p2: { largest: { url: 'https://evil.example.com/b.jpg' } },
                },
                user: {
                    id: 9001,
                    screen_name: '测试作者',
                    avatar_large: 'https://tvax1.sinaimg.cn/avatar.jpg',
                },
            }),
        )
        expect(post?.media.images).toEqual(['https://wx1.sinaimg.cn/large/a.jpg'])
        expect(post?.media.thumbnails).toEqual(['https://wx1.sinaimg.cn/bmiddle/a.jpg'])
        // 计数按可用直链算：非图床地址被丢弃后不应再计入展示数
        expect(post?.media.imageCount).toBe(1)
        expect(post?.author.avatarUrl).toBe('https://tvax1.sinaimg.cn/avatar.jpg')
        expect(post?.segments).toEqual([
            { type: 'text', text: '看表情' },
            { type: 'emoji', name: '微笑', url: 'https://face.t.sinajs.cn/a.png' },
            { type: 'text', text: '继续' },
        ])
    })

    it('尺寸取 largest 档，中图取 bmiddle 档，原图取 largest 档', () => {
        const post = normalizeTimelinePost(
            rawStatus(108, {
                pic_infos: {
                    pid1: {
                        thumbnail: { url: 'https://wx1.sinaimg.cn/wap180/a.jpg', width: 135, height: 180 },
                        bmiddle: { url: 'https://wx1.sinaimg.cn/wap360/a.jpg', width: 270, height: 360 },
                        large: { url: 'https://wx1.sinaimg.cn/orj960/a.jpg', width: 960, height: 1280 },
                        original: { url: 'https://wx1.sinaimg.cn/orj1080/a.jpg', width: 1080, height: 1440 },
                        largest: { url: 'https://wx1.sinaimg.cn/large/a.jpg', width: 1320, height: 1760 },
                    },
                },
            }),
        )
        expect(post?.media.images).toEqual(['https://wx1.sinaimg.cn/large/a.jpg'])
        expect(post?.media.thumbnails).toEqual(['https://wx1.sinaimg.cn/wap360/a.jpg'])
        expect(post?.media.sizes).toEqual([{ width: 1320, height: 1760 }])
    })

    it('缺少 text_raw 时纯文本仍保留表情名', () => {
        const post = normalizeTimelinePost(
            rawStatus(105, {
                text_raw: undefined,
                text: '笑<img src="https://face.t.sinajs.cn/a.png" title="微笑">了',
            }),
        )
        expect(post?.text).toBe('笑[微笑]了')
        expect(post?.segments).toEqual([
            { type: 'text', text: '笑' },
            { type: 'emoji', name: '微笑', url: 'https://face.t.sinajs.cn/a.png' },
            { type: 'text', text: '了' },
        ])
    })
})

describe('图片格式嗅探', () => {
    it('内容类型缺失时按文件头识别 jpg / png / gif / webp', () => {
        expect(sniffImageExtension(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('jpg')
        expect(sniffImageExtension(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))).toBe(
            'png',
        )
        expect(sniffImageExtension(Buffer.from('GIF89a000000', 'latin1'))).toBe('gif')
        const webp = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WEBP', 'latin1')])
        expect(sniffImageExtension(webp)).toBe('webp')
    })

    it('无法识别的字节返回 null，避免把 HTML 错误页当图片缓存', () => {
        expect(sniffImageExtension(Buffer.from('<html>403</html>', 'latin1'))).toBeNull()
        expect(sniffImageExtension(Buffer.from([0xff]))).toBeNull()
    })

    it('回传 Webview 的 data URI 按扩展名给 MIME', () => {
        expect(buildImageDataUrl(Buffer.from([0x89, 0x50]), 'PNG')).toBe('data:image/png;base64,iVA=')
        expect(buildImageDataUrl(Buffer.from([0xff]), 'unknown')).toBe('data:image/jpeg;base64,/w==')
    })
})

describe('评论接口与归一化', () => {
    it('首页带 is_reload=1，翻页改带 max_id', () => {
        const first = new URL(buildCommentsUrl({ cookie: 'SUB=x', id: '5367006225500300', count: 10 }))
        expect(first.searchParams.get('is_reload')).toBe('1')
        expect(first.searchParams.get('id')).toBe('5367006225500300')
        expect(first.searchParams.get('count')).toBe('10')
        expect(first.searchParams.get('is_show_bulletin')).toBe('3')
        expect(first.searchParams.get('locale')).toBe('zh-CN')
        expect(first.searchParams.has('max_id')).toBe(false)

        const next = new URL(
            buildCommentsUrl({ cookie: 'SUB=x', id: '5367006225500300', maxId: '1380000000000000', count: 10 }),
        )
        expect(next.searchParams.has('is_reload')).toBe(false)
        expect(next.searchParams.get('max_id')).toBe('1380000000000000')
    })

    it('条数夹取，uid 可选', () => {
        expect(clampCommentCount(0)).toBe(1)
        expect(clampCommentCount(99)).toBe(30)
        const withUid = new URL(buildCommentsUrl({ cookie: 'SUB=x', id: '1', uid: '7810677599' }))
        expect(withUid.searchParams.get('uid')).toBe('7810677599')
        const withoutUid = new URL(buildCommentsUrl({ cookie: 'SUB=x', id: '1' }))
        expect(withoutUid.searchParams.has('uid')).toBe(false)
    })

    it('正文按分段解析，表情名保留在纯文本里', () => {
        const comment = normalizeWebComment({
            idstr: '5000000000000001',
            text: '好图<img src="https://face.t.sinajs.cn/a.png" title="赞">',
            created_at: 'Wed Nov 19 10:00:00 +0800 2026',
            like_counts: 3,
            user: { id: 9001, screen_name: '评论者', avatar_large: 'https://tvax1.sinaimg.cn/a.jpg' },
        })
        expect(comment?.text).toBe('好图[赞]')
        expect(comment?.segments).toEqual([
            { type: 'text', text: '好图' },
            { type: 'emoji', name: '赞', url: 'https://face.t.sinajs.cn/a.png' },
        ])
        expect(comment?.createdAt).toBe('2026-11-19T02:00:00.000Z')
        expect(comment?.author.name).toBe('评论者')
        expect(comment?.author.avatarUrl).toBe('https://tvax1.sinaimg.cn/a.jpg')
        expect(comment?.likes).toBe(3)
    })

    it('缺少 id 的评论丢弃', () => {
        expect(normalizeWebComment({ text: '无 id' })).toBeNull()
    })
})

describe('微博协议路由：评论', () => {
    const configuredCookieStore: WeiboCookieStore = {
        read: () => Promise.resolve('SUB=x'),
        write: () => Promise.resolve(),
        remove: () => Promise.resolve(),
        readSavedAt: () => Promise.resolve(undefined),
        writeSavedAt: () => Promise.resolve(),
        removeSavedAt: () => Promise.resolve(),
    }

    it('按参数透传并回包分页结果', async () => {
        const calls: Array<{ id: string; maxId: string | null | undefined }> = []
        const routes = new WeiboRoutes({
            cookieStore: configuredCookieStore,
            fetchComments: (options): Promise<WeiboCommentsResult> => {
                calls.push({ id: options.id, maxId: options.maxId })
                return Promise.resolve({
                    comments: [],
                    totalNumber: 2,
                    maxId: '1380000000000000',
                    hasMore: true,
                })
            },
        })
        await expect(routes.handle('weibo/comments', { id: '5367006225500300', count: 10 })).resolves.toMatchObject({
            totalNumber: 2,
            hasMore: true,
        })
        expect(calls).toEqual([{ id: '5367006225500300', maxId: undefined }])
    })

    it('未配置 Cookie 时拒绝', async () => {
        const routes = new WeiboRoutes({
            cookieStore: {
                ...configuredCookieStore,
                read: (): Promise<string | undefined> => Promise.resolve(undefined),
            },
        })
        await expect(routes.handle('weibo/comments', { id: '5367006225500300' })).rejects.toThrowError(/Cookie/u)
    })

    it('id 非纯数字时拒绝', async () => {
        const routes = new WeiboRoutes({ cookieStore: configuredCookieStore })
        await expect(routes.handle('weibo/comments', { id: 'abc' })).rejects.toThrowError(/weibo\/comments/u)
    })
})

describe('长文接口与归一化', () => {
    it('按 mblogid 构造地址', () => {
        const url = new URL(buildLongTextUrl('Rs4KtdzoV'))
        expect(url.pathname).toBe('/ajax/statuses/longtext')
        expect(url.searchParams.get('id')).toBe('Rs4KtdzoV')
    })

    it('优先 longTextContent，缺失回退 longTextContent_raw', () => {
        expect(parseLongTextPayload(JSON.stringify({ ok: 1, data: { longTextContent: '全文' } }), 200)).toEqual({
            text: '全文',
        })
        expect(parseLongTextPayload(JSON.stringify({ ok: 1, data: { longTextContent_raw: '原始全文' } }), 200)).toEqual(
            { text: '原始全文' },
        )
    })

    it('内容为空或返回 HTML 时报错', () => {
        expect(() => parseLongTextPayload(JSON.stringify({ ok: 1, data: {} }), 200)).toThrowError(/长文内容为空/u)
        expect(() => parseLongTextPayload('<html>login</html>', 200)).toThrowError(/登录态/u)
    })

    it('摘要里的「展开全文」链接被剥离，且标记为长文', () => {
        const post = normalizeTimelinePost(
            rawStatus(112, {
                isLongText: true,
                text_raw: undefined,
                text: '前半段<a href="https://weibo.com/x">展开全文</a>',
            }),
        )
        expect(post?.isLongText).toBe(true)
        expect(post?.text).toBe('前半段')
        expect(post?.segments).toEqual([{ type: 'text', text: '前半段' }])
    })

    it('摘要末尾的省略号 + 展开（含链接与纯文本）一并清掉', () => {
        const withLink = normalizeTimelinePost(
            rawStatus(113, {
                isLongText: true,
                text_raw: undefined,
                text: '前半段……<a href="https://weibo.com/x">展开</a>',
            }),
        )
        expect(withLink?.text).toBe('前半段')
        expect(withLink?.segments).toEqual([{ type: 'text', text: '前半段' }])

        const withDots = normalizeTimelinePost(rawStatus(114, { isLongText: true, text_raw: '另一段...展开' }))
        expect(withDots?.text).toBe('另一段')
        expect(withDots?.segments).toEqual([{ type: 'text', text: '另一段' }])
    })

    it('普通微博正文里的「展开」不受影响', () => {
        const post = normalizeTimelinePost(rawStatus(115, { text_raw: '这段讲展开与收缩的区别' }))
        expect(post?.text).toBe('这段讲展开与收缩的区别')
    })
})

describe('微博协议路由：长文', () => {
    const configuredCookieStore: WeiboCookieStore = {
        read: () => Promise.resolve('SUB=x'),
        write: () => Promise.resolve(),
        remove: () => Promise.resolve(),
        readSavedAt: () => Promise.resolve(undefined),
        writeSavedAt: () => Promise.resolve(),
        removeSavedAt: () => Promise.resolve(),
    }

    it('按 id 透传并回包全文', async () => {
        const calls: string[] = []
        const routes = new WeiboRoutes({
            cookieStore: configuredCookieStore,
            fetchLongText: (options): Promise<WeiboLongTextResult> => {
                calls.push(options.id)
                return Promise.resolve({ text: '全文正文' })
            },
        })
        await expect(routes.handle('weibo/longtext', { id: 'Rs4KtdzoV' })).resolves.toEqual({ text: '全文正文' })
        expect(calls).toEqual(['Rs4KtdzoV'])
    })

    it('未配置 Cookie 时拒绝', async () => {
        const routes = new WeiboRoutes({
            cookieStore: {
                ...configuredCookieStore,
                read: (): Promise<string | undefined> => Promise.resolve(undefined),
            },
        })
        await expect(routes.handle('weibo/longtext', { id: 'Rs4KtdzoV' })).rejects.toThrowError(/Cookie/u)
    })

    it('id 含非法字符时拒绝', async () => {
        const routes = new WeiboRoutes({ cookieStore: configuredCookieStore })
        await expect(routes.handle('weibo/longtext', { id: 'bad*id' })).rejects.toThrowError(/weibo\/longtext/u)
    })
})

describe('点赞状态归一化', () => {
    it('兼容对象与数字两种 attitudes_status 形态', () => {
        expect(normalizeTimelinePost(rawStatus(109, { attitudes_status: { liked: true } }))?.isLiked).toBe(true)
        expect(normalizeTimelinePost(rawStatus(110, { attitudes_status: 1 }))?.isLiked).toBe(true)
        expect(normalizeTimelinePost(rawStatus(111))?.isLiked).toBe(false)
    })
})

describe('微博协议路由：点赞', () => {
    const configuredCookieStore: WeiboCookieStore = {
        read: () => Promise.resolve('SUB=x'),
        write: () => Promise.resolve(),
        remove: () => Promise.resolve(),
        readSavedAt: () => Promise.resolve(undefined),
        writeSavedAt: () => Promise.resolve(),
        removeSavedAt: () => Promise.resolve(),
    }

    const anonymousCookieStore: WeiboCookieStore = {
        read: () => Promise.resolve(undefined),
        write: () => Promise.resolve(),
        remove: () => Promise.resolve(),
        readSavedAt: () => Promise.resolve(undefined),
        writeSavedAt: () => Promise.resolve(),
        removeSavedAt: () => Promise.resolve(),
    }

    it('按目标状态调用 setLike 并回传最新点赞数', async () => {
        const calls: Array<{ id: string; liked: boolean }> = []
        const routes = new WeiboRoutes({
            cookieStore: configuredCookieStore,
            setLike: (options): Promise<WeiboLikeResult> => {
                calls.push({ id: options.id, liked: options.liked })
                return Promise.resolve({ liked: options.liked, attitudesCount: 42 })
            },
        })
        await expect(routes.handle('weibo/like', { id: '5200000000000001', liked: true })).resolves.toEqual({
            liked: true,
            attitudesCount: 42,
        })
        expect(calls).toEqual([{ id: '5200000000000001', liked: true }])
    })

    it('未配置 Cookie 时直接拒绝，不发写请求', async () => {
        const routes = new WeiboRoutes({ cookieStore: anonymousCookieStore })
        await expect(routes.handle('weibo/like', { id: '5200000000000001', liked: true })).rejects.toThrowError(
            /Cookie/u,
        )
    })

    it('id 非纯数字时拒绝', async () => {
        const routes = new WeiboRoutes({ cookieStore: configuredCookieStore })
        await expect(routes.handle('weibo/like', { id: 'AbC123', liked: true })).rejects.toThrowError(/weibo\/like/u)
    })
})

describe('微博协议路由：图片代理', () => {
    const cookieStore: WeiboCookieStore = {
        read: () => Promise.resolve(undefined),
        write: () => Promise.resolve(),
        remove: () => Promise.resolve(),
        readSavedAt: () => Promise.resolve(undefined),
        writeSavedAt: () => Promise.resolve(),
        removeSavedAt: () => Promise.resolve(),
    }

    it('注入解析器时返回 Webview 可加载的本地地址', async () => {
        const routes = new WeiboRoutes({
            cookieStore,
            resolveImageUrl: (imageUrl: string): Promise<string> => Promise.resolve(`local:${imageUrl}`),
        })
        await expect(routes.handle('weibo/image', { url: 'https://wx1.sinaimg.cn/large/a.jpg' })).resolves.toEqual({
            url: 'local:https://wx1.sinaimg.cn/large/a.jpg',
        })
    })

    it('未注入解析器时返回 null 而不是抛错', async () => {
        const routes = new WeiboRoutes({ cookieStore })
        await expect(routes.handle('weibo/image', { url: 'https://wx1.sinaimg.cn/large/a.jpg' })).resolves.toEqual({
            url: null,
        })
    })

    it('参数非法时拒绝', async () => {
        const routes = new WeiboRoutes({ cookieStore })
        await expect(routes.handle('weibo/image', { url: 123 })).rejects.toThrowError(/weibo\/image/u)
    })
})

describe('normalizeCookieInput', () => {
    it('兼容 Cookie: 前缀、换行与多余空格', () => {
        const cookie = normalizeCookieInput('Cookie: SUB=abc;\r\nSUBP=def;  \n XSRF-TOKEN=ghi')
        expect(cookie).toBe('SUB=abc; SUBP=def; XSRF-TOKEN=ghi')
    })

    it('缺少 SUB 时拒绝并给出获取路径', () => {
        expect(() => normalizeCookieInput('SUBP=def')).toThrowError(/SUB/u)
    })

    it('空输入直接拒绝', () => {
        expect(() => normalizeCookieInput('   ')).toThrowError(/为空/u)
    })
})
