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
    normalizeWeiboVideoUrl,
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

    it('点赞列表的驼峰 isAd 与 mark 推广标记同样按广告丢弃', () => {
        expect(normalizeTimelinePost(rawStatus(104, { isAd: true }))).toBeNull()
        expect(normalizeTimelinePost(rawStatus(105, { mark: '999_reallog_mark_ad:999|WeiboADNatural' }))).toBeNull()
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

    it('增量起点优先用上游 since_id：首页进度游标与微博 id 不同量级', async () => {
        const result = await fetchFriendTimeline({
            cookie: 'SUB=x',
            minIntervalMs: 0,
            requestPage: () =>
                Promise.resolve({
                    statuses: [rawStatus(601)],
                    sinceId: '1795177409209985',
                    maxId: '1795177409209985',
                }),
        })
        expect(result.sinceId).toBe('1795177409209985')
        expect(result.hasMore).toBe(true)
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
        expect(buildMiddleImageUrl('https://wx1.sinaimg.cn/orj960/a.jpg')).toBe('https://wx1.sinaimg.cn/bmiddle/a.jpg')
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
                                    // DASH 分片不能直接播，整段 mp4 才是播放源
                                    playback_list: [{ play_info: { url: 'https://f.video.weibocdn.com/dash.mp4' } }],
                                    mp4_hd_url: 'https://f.video.weibocdn.com/x.mp4',
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

    it('没有表情名的卡片图标直接跳过，既不当表情也不留占位', () => {
        const segments = parsePostSegments(
            '视频来了<a href="https://video.weibo.com/x"><img src="https://h5.sinaimg.cn/upload/2015/09/25/3/timeline_card_small_video_default.png" alt="http://t.cn/AXTV2Qdr">某某的微博视频</a>',
        )
        expect(segments).toEqual([{ type: 'text', text: '视频来了某某的微博视频' }])
    })

    it('@账号、话题、超话与短链落成链接段，协议相对地址升级为 https', () => {
        const segments = parsePostSegments(
            '谢谢<a href="//weibo.com/u/12345" usercard="id=12345">@小明</a>，' +
                '看<a href="//s.weibo.com/weibo?q=%23%E7%83%AD%E9%97%A8%23">#热门#</a>，' +
                '超话<a href="https://weibo.com/p/100808abc123">#读书#</a>，' +
                '原文<a href="http://t.cn/A6xyz">网页链接</a>',
        )
        expect(segments).toEqual([
            { type: 'text', text: '谢谢' },
            { type: 'link', text: '@小明', url: 'https://weibo.com/u/12345', kind: 'mention' },
            { type: 'text', text: '，看' },
            {
                type: 'link',
                text: '#热门#',
                url: 'https://s.weibo.com/weibo?q=%23%E7%83%AD%E9%97%A8%23',
                kind: 'topic',
            },
            { type: 'text', text: '，超话' },
            { type: 'link', text: '#读书#', url: 'https://weibo.com/p/100808abc123', kind: 'supertopic' },
            { type: 'text', text: '，原文' },
            { type: 'link', text: '网页链接', url: 'https://t.cn/A6xyz', kind: 'link' },
        ])
    })

    it('非白名单域名的锚点降级为纯文本，不把任意地址带进正文', () => {
        expect(parsePostSegments('前<a href="https://evil.example.com/x">后</a>')).toEqual([
            { type: 'text', text: '前后' },
        ])
    })

    it('href 是 javascript:void(0) 时用 usercard 里的 uid 兜底', () => {
        expect(parsePostSegments('<a href="javascript:void(0);" usercard="id=12345">@小明</a>')).toEqual([
            { type: 'link', text: '@小明', url: 'https://weibo.com/u/12345', kind: 'mention' },
        ])
    })

    it('完全没有 href 的 @ 账号按昵称主页兜底', () => {
        expect(parsePostSegments('前<a>@小红</a>')).toEqual([
            { type: 'text', text: '前' },
            { type: 'link', text: '@小红', url: 'https://weibo.com/n/%E5%B0%8F%E7%BA%A2', kind: 'mention' },
        ])
    })

    it('属性值没有引号也能解析，data-href 不冒充 href', () => {
        expect(parsePostSegments('<a href=//weibo.com/u/12345>@小明</a>')).toEqual([
            { type: 'link', text: '@小明', url: 'https://weibo.com/u/12345', kind: 'mention' },
        ])
        expect(parsePostSegments('<a data-href="https://weibo.com/u/999" usercard="id=12345">@小明</a>')).toEqual([
            { type: 'link', text: '@小明', url: 'https://weibo.com/u/12345', kind: 'mention' },
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

    it('尺寸取 largest 档，展示图取 large 档，原图取 largest 档', () => {
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
        // 九宫格与卡片内预览都用长边 960 的 large 档：bmiddle 只有 360，铺到卡片宽度会发虚
        expect(post?.media.thumbnails).toEqual(['https://wx1.sinaimg.cn/orj960/a.jpg'])
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

    it('转发体保留原文媒体：图片与视频封面都能渲染', () => {
        const post = normalizeTimelinePost(
            rawStatus(120, {
                retweeted_status: {
                    id: 900,
                    idstr: '900',
                    mblogid: 'RT900',
                    text_raw: '原文',
                    user: { id: 9001, screen_name: '原作者' },
                    pic_ids: ['rp1'],
                    pic_num: 1,
                    pic_infos: {
                        rp1: {
                            largest: { url: 'https://wx1.sinaimg.cn/large/rp1.jpg', width: 800, height: 600 },
                            bmiddle: { url: 'https://wx1.sinaimg.cn/wap360/rp1.jpg', width: 360, height: 270 },
                        },
                    },
                    page_info: {
                        type: 11,
                        object_type: 'video',
                        page_pic: 'https://wx4.sinaimg.cn/orj480/cover.jpg',
                        media_info: { duration: 33 },
                    },
                },
            }),
        )
        expect(post?.retweeted?.media.images).toEqual(['https://wx1.sinaimg.cn/large/rp1.jpg'])
        expect(post?.retweeted?.media.videoCount).toBe(1)
        expect(post?.retweeted?.media.items).toEqual([
            expect.objectContaining({ kind: 'image' }),
            expect.objectContaining({ kind: 'video', durationSeconds: 33 }),
        ])
        expect(post?.retweeted?.media.items[1]).toMatchObject({ coverUrl: 'https://wx4.sinaimg.cn/orj480/cover.jpg' })
    })

    it('转发体带出原作者 uid、认证标记与发布时间', () => {
        const post = normalizeTimelinePost(
            rawStatus(121, {
                retweeted_status: {
                    id: 902,
                    idstr: '902',
                    mblogid: 'RT902',
                    text_raw: '原文',
                    created_at: 'Wed Nov 19 10:00:00 +0800 2026',
                    user: { id: 9002, screen_name: '认证作者', verified: true },
                },
            }),
        )
        expect(post?.retweeted?.authorId).toBe('9002')
        expect(post?.retweeted?.authorIsVerified).toBe(true)
        expect(post?.retweeted?.createdAtRaw).toBe('Wed Nov 19 10:00:00 +0800 2026')
        expect(post?.retweeted?.createdAt).not.toBe('')
    })

    it('转发体正文同样切出可点链接', () => {
        const post = normalizeTimelinePost(
            rawStatus(123, {
                retweeted_status: {
                    id: 904,
                    idstr: '904',
                    mblogid: 'RT904',
                    text: '转发<a href="//weibo.com/n/%E5%B0%8F%E7%BA%A2">@小红</a>',
                },
            }),
        )
        expect(post?.retweeted?.segments).toEqual([
            { type: 'text', text: '转发' },
            { type: 'link', text: '@小红', url: 'https://weibo.com/n/%E5%B0%8F%E7%BA%A2', kind: 'mention' },
        ])
    })

    it('转发体正文的表情与主贴同口径切成内联表情段', () => {
        const post = normalizeTimelinePost(
            rawStatus(124, {
                retweeted_status: {
                    id: 905,
                    idstr: '905',
                    mblogid: 'RT905',
                    text: '原文<img src="https://face.t.sinajs.cn/a.png" title="微笑">结尾',
                },
            }),
        )
        expect(post?.retweeted?.segments).toEqual([
            { type: 'text', text: '原文' },
            { type: 'emoji', name: '微笑', url: 'https://face.t.sinajs.cn/a.png' },
            { type: 'text', text: '结尾' },
        ])
        // 纯文本口径仍把表情还原成 [名称]，两套口径互不影响
        expect(post?.retweeted?.text).toBe('原文[微笑]结尾')
    })

    it('转发体缺认证与时间时不误标，作者 uid 回退空串', () => {
        const post = normalizeTimelinePost(
            rawStatus(122, {
                retweeted_status: { id: 903, idstr: '903', text_raw: '原文' },
            }),
        )
        expect(post?.retweeted?.authorId).toBe('')
        expect(post?.retweeted?.authorIsVerified).toBe(false)
        expect(post?.retweeted?.createdAt).toBe('')
        expect(post?.retweeted?.createdAtRaw).toBe('')
    })

    it('isLongText 只在有「全文」入口或展开痕迹时成立，带视频卡片的普通微博不误标', () => {
        const cardOnly = normalizeTimelinePost(
            rawStatus(118, {
                isLongText: true,
                text_raw: '视频来了 http://t.cn/AXTV2Qdr',
                text: '视频来了<a href="https://video.weibo.com/x"><img src="https://h5.sinaimg.cn/x.png"/>某某的微博视频</a>',
            }),
        )
        expect(cardOnly?.isLongText).toBe(false)

        const withContinueTag = normalizeTimelinePost(
            rawStatus(119, { isLongText: true, text_raw: '正文', continue_tag: { title: '全文' } }),
        )
        expect(withContinueTag?.isLongText).toBe(true)
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

describe('阅读数归一化', () => {
    it('reads_count 数字与数字字符串都收下，0 视为真实零阅读', () => {
        expect(normalizeTimelinePost(rawStatus(130, { reads_count: 12_345 }))?.readsCount).toBe(12_345)
        expect(normalizeTimelinePost(rawStatus(131, { reads_count: '678' }))?.readsCount).toBe(678)
        expect(normalizeTimelinePost(rawStatus(132, { reads_count: 0 }))?.readsCount).toBe(0)
    })

    it('缺失或非数字一律为 null，不能把「没下发」当成 0', () => {
        expect(normalizeTimelinePost(rawStatus(133))?.readsCount).toBeNull()
        expect(normalizeTimelinePost(rawStatus(134, { reads_count: '未知' }))?.readsCount).toBeNull()
        expect(normalizeTimelinePost(rawStatus(135, { reads_count: -5 }))?.readsCount).toBeNull()
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

describe('mix_media_info 图文混排', () => {
    it('按上游原序保留图文交错顺序，视频项带封面与时长', () => {
        const post = normalizeTimelinePost(
            rawStatus(201, {
                mix_media_info: {
                    items: [
                        { type: 'pic', data: { largest: { url: 'https://wx1.sinaimg.cn/large/a.jpg' } } },
                        {
                            type: 'video',
                            data: {
                                page_info: {
                                    page_pic: 'https://wx1.sinaimg.cn/large/cover.jpg',
                                    media_info: { duration: 93 },
                                },
                            },
                        },
                        { type: 'pic', data: { largest: { url: 'https://wx1.sinaimg.cn/large/b.jpg' } } },
                    ],
                },
            }),
        )
        expect(post?.media.items.map((item) => item.kind)).toEqual(['image', 'video', 'image'])
        expect(post?.media.images).toEqual(['https://wx1.sinaimg.cn/large/a.jpg', 'https://wx1.sinaimg.cn/large/b.jpg'])
        expect(post?.media.videoCount).toBe(1)
        expect(post?.media.items[1]).toEqual({
            kind: 'video',
            coverUrl: 'https://wx1.sinaimg.cn/large/cover.jpg',
            coverMiddleUrl: 'https://wx1.sinaimg.cn/bmiddle/cover.jpg',
            durationSeconds: 93,
            playUrl: null,
            resolution: null,
        })
    })

    it('imageCount 只数图片，视频单独计数', () => {
        const post = normalizeTimelinePost(
            rawStatus(202, {
                pic_num: 1,
                mix_media_info: {
                    items: [
                        { type: 'pic', data: { largest: { url: 'https://wx1.sinaimg.cn/large/a.jpg' } } },
                        { type: 'video', data: { page_pic: 'https://wx1.sinaimg.cn/large/cover.jpg' } },
                    ],
                },
            }),
        )
        expect(post?.media.imageCount).toBe(1)
        expect(post?.media.videoCount).toBe(1)
    })

    it('pic_infos 与 mix_media_info 指向同一张图时只保留一份', () => {
        const post = normalizeTimelinePost(
            rawStatus(203, {
                pic_infos: {
                    '0064ZtQNabc123': { largest: { url: 'https://wx1.sinaimg.cn/large/same.jpg' } },
                },
                mix_media_info: {
                    items: [
                        {
                            type: 'pic',
                            id: '0064ZtQNabc123',
                            data: { largest: { url: 'https://wx1.sinaimg.cn/large/same.jpg' } },
                        },
                    ],
                },
            }),
        )
        expect(post?.media.images).toEqual(['https://wx1.sinaimg.cn/large/same.jpg'])
        expect(post?.media.items).toHaveLength(1)
    })

    it('mix 只给视频时，pic_infos 的图片补在尾部', () => {
        const post = normalizeTimelinePost(
            rawStatus(204, {
                pic_infos: { '0064ZtQNabc777': { largest: { url: 'https://wx1.sinaimg.cn/large/p.jpg' } } },
                mix_media_info: {
                    items: [{ type: 'video', data: { page_pic: 'https://wx1.sinaimg.cn/large/cover.jpg' } }],
                },
            }),
        )
        expect(post?.media.items.map((item) => item.kind)).toEqual(['video', 'image'])
    })

    it('只有 page_info 的旧版视频补一个视频项', () => {
        const post = normalizeTimelinePost(
            rawStatus(205, {
                page_info: {
                    page_pic: 'https://wx1.sinaimg.cn/large/cover.jpg',
                    media_info: { duration: 12, stream_url: 'https://f.video.weibocdn.com/x.mp4' },
                },
            }),
        )
        expect(post?.media.videoCount).toBe(1)
        expect(post?.media.items).toEqual([
            {
                kind: 'video',
                coverUrl: 'https://wx1.sinaimg.cn/large/cover.jpg',
                coverMiddleUrl: 'https://wx1.sinaimg.cn/bmiddle/cover.jpg',
                durationSeconds: 12,
                playUrl: 'https://f.video.weibocdn.com/x.mp4',
                resolution: null,
            },
        ])
        expect(post?.media.videoUrl).toBe('https://f.video.weibocdn.com/x.mp4')
    })

    it('清晰度角标取 playback_list 里最大的一档，缺失时用 template 兜底', () => {
        const withPlayback = normalizeTimelinePost(
            rawStatus(208, {
                page_info: {
                    type: 11,
                    object_type: 'video',
                    page_pic: 'https://wx1.sinaimg.cn/large/cover.jpg',
                    media_info: {
                        duration: 30,
                        mp4_hd_url: 'http://f.video.weibocdn.com/x.mp4',
                        playback_list: [
                            { play_info: { width: 480, height: 854 } },
                            { play_info: { width: 720, height: 1280 } },
                            { play_info: { width: 360, height: 640 } },
                        ],
                    },
                },
            }),
        )
        expect(withPlayback?.media.items[0]).toMatchObject({
            kind: 'video',
            resolution: { width: 720, height: 1280 },
        })

        const withTemplate = normalizeTimelinePost(
            rawStatus(209, {
                page_info: {
                    type: 11,
                    object_type: 'video',
                    media_info: {
                        duration: 12,
                        mp4_sd_url: 'http://f.video.weibocdn.com/y.mp4?template=1080x1920.30.0',
                    },
                },
            }),
        )
        expect(withTemplate?.media.items[0]).toMatchObject({
            kind: 'video',
            resolution: { width: 1080, height: 1920 },
        })
    })

    it('转发体带视频时外层不再重复显示视频，只保留图片', () => {
        const post = normalizeTimelinePost(
            rawStatus(207, {
                pic_ids: ['0064ZtQNabc888'],
                pic_num: 1,
                pic_infos: {
                    '0064ZtQNabc888': { largest: { url: 'https://wx1.sinaimg.cn/large/outer.jpg' } },
                },
                page_info: {
                    type: 11,
                    object_type: 'video',
                    page_pic: 'https://wx1.sinaimg.cn/large/outer-cover.jpg',
                    media_info: { duration: 10, mp4_sd_url: 'http://f.video.weibocdn.com/outer.mp4' },
                },
                retweeted_status: {
                    id: 901,
                    idstr: '901',
                    mblogid: 'RT901',
                    text_raw: '原文',
                    user: { id: 9001, screen_name: '原作者' },
                    page_info: {
                        type: 11,
                        object_type: 'video',
                        page_pic: 'https://wx1.sinaimg.cn/large/inner-cover.jpg',
                        media_info: { duration: 20, mp4_sd_url: 'http://f.video.weibocdn.com/inner.mp4' },
                    },
                },
            }),
        )
        expect(post?.media.videoCount).toBe(0)
        expect(post?.media.videoUrl).toBeNull()
        expect(post?.media.items.map((item) => item.kind)).toEqual(['image'])
        expect(post?.media.images).toEqual(['https://wx1.sinaimg.cn/large/outer.jpg'])
        expect(post?.retweeted?.media.videoCount).toBe(1)
        expect(post?.retweeted?.media.items[0]).toMatchObject({
            kind: 'video',
            playUrl: 'https://f.video.weibocdn.com/inner.mp4',
        })
    })

    it('http 视频直链升级为 https，非白名单主机一律丢弃', () => {
        expect(normalizeWeiboVideoUrl('http://f.video.weibocdn.com/x.mp4?a=1')).toBe(
            'https://f.video.weibocdn.com/x.mp4?a=1',
        )
        expect(normalizeWeiboVideoUrl('//f.video.weibocdn.com/x.mp4')).toBe('https://f.video.weibocdn.com/x.mp4')
        expect(normalizeWeiboVideoUrl('https://evil.example.com/x.mp4')).toBeNull()
    })

    it('播放地址只取整段 mp4：只有 DASH 分片时不给播放源', () => {
        const post = normalizeTimelinePost(
            rawStatus(206, {
                page_info: {
                    type: 11,
                    object_type: 'video',
                    page_pic: 'https://wx1.sinaimg.cn/large/cover.jpg',
                    media_info: {
                        duration: 20,
                        playback_list: [{ play_info: { url: 'https://f.video.weibocdn.com/dash.mp4' } }],
                    },
                },
            }),
        )
        expect(post?.media.items).toHaveLength(1)
        expect(post?.media.items[0]).toMatchObject({ kind: 'video', playUrl: null, durationSeconds: 20 })
        expect(post?.media.videoUrl).toBeNull()
    })
})
