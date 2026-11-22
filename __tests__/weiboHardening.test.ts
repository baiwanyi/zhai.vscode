/**
 * 微博模块加固项回归：Cookie 发送域、并发节流、超时重试、正文解析边界与写操作互斥。
 * 复用约定：全部不触网——fetch 与取数实现由用例注入，断言只针对请求头、时间戳与归一化结果。
 * 关键约束：每个用例对应审计中的一项修复（SEC-01/02/04、PERF-03/04），
 * 改动这些行为时应同步更新用例，不允许删除用例换取通过。
 */
import { describe, expect, it, vi } from 'vitest'
import { buildStableFingerprint } from '@modules/weibo/api/write/publish'
import { warmWeiboMetadata } from '@modules/weibo/app/warmup'
import { buildRequestHeaders } from '@modules/weibo/media/imageNetwork'
import { fetchUpstream } from '@modules/weibo/media/videoServer'
import { WeiboRoutes } from '@modules/weibo/protocol/routes'
import type { WeiboCookieStore } from '@modules/weibo/store/credential'
import type { WeiboCache } from '@modules/weibo/store/metadataCache'
import { fetchFriendTimeline, normalizeTimelinePost } from '@modules/weibo/timeline/query'
import { requestWeiboJson } from '@modules/weibo/transport/httpClient'
import type { TimelinePage } from '@modules/weibo/transport/httpClient'
import type { WeiboGroupsResult, WeiboLikeResult, WeiboProfile } from '@shared/types/weibo'
import { WEIBO_METHODS } from '@shared/types/weiboMethods'
import { resolveVideoDisplayDuration } from '@webview/weibo/utils/weiboTime'

/** 构造最小可用的上游微博：只给归一化必需字段，其余按缺失处理 */
function rawStatus(id: string): Record<string, unknown> {
    return {
        id,
        idstr: id,
        text_raw: `正文 ${id}`,
        created_at: 'Wed Nov 19 10:00:00 +0800 2026',
        user: { id: 9001, screen_name: '测试作者' },
    }
}

/** 构造只读凭证的存取器：写操作在用例里不关心 */
function createCookieStore(cookie: string): WeiboCookieStore {
    return {
        read: (): PromiseLike<string | undefined> => Promise.resolve(cookie),
        write: (): PromiseLike<void> => Promise.resolve(),
        remove: (): PromiseLike<void> => Promise.resolve(),
        readSavedAt: (): PromiseLike<string | undefined> => Promise.resolve('2026-11-23T00:00:00.000Z'),
        writeSavedAt: (): PromiseLike<void> => Promise.resolve(),
        removeSavedAt: (): PromiseLike<void> => Promise.resolve(),
    }
}

describe('图片代理请求头', () => {
    it('登录 Cookie 只发往 weibo.com 域', () => {
        expect(buildRequestHeaders('https://weibo.com/ajax/common/download?pid=1', 'SUB=abc').Cookie).toBe('SUB=abc')
        expect(buildRequestHeaders('https://wx1.sinaimg.cn/large/a.jpg', 'SUB=abc').Cookie).toBeUndefined()
        expect(buildRequestHeaders('https://weibo.com.evil.com/a.jpg', 'SUB=abc').Cookie).toBeUndefined()
        expect(buildRequestHeaders('https://weibo.com/a.jpg', undefined).Cookie).toBeUndefined()
    })
})

describe('请求节流与超时', () => {
    it('并发请求按最小间隔排队，不会同时放行', async () => {
        const stamps: number[] = []
        const fetchMock = vi.fn((): Promise<Response> => {
            stamps.push(Date.now())
            return Promise.resolve(new Response(JSON.stringify({ ok: 1 }), { status: 200 }))
        })
        vi.stubGlobal('fetch', fetchMock)
        try {
            const query = { cookie: 'SUB=1', minIntervalMs: 80 }
            await Promise.all([
                requestWeiboJson({ ...query, url: 'https://weibo.com/ajax/a' }),
                requestWeiboJson({ ...query, url: 'https://weibo.com/ajax/b' }),
                requestWeiboJson({ ...query, url: 'https://weibo.com/ajax/c' }),
            ])
        } finally {
            vi.unstubAllGlobals()
        }
        expect(stamps).toHaveLength(3)
        const first = stamps.at(0) ?? 0
        const second = stamps.at(1) ?? 0
        const third = stamps.at(2) ?? 0
        expect(second - first).toBeGreaterThanOrEqual(60)
        expect(third - second).toBeGreaterThanOrEqual(60)
    })

    it('超时不重试：TimeoutError 只发起一次请求', async () => {
        const fetchMock = vi.fn((): Promise<Response> => {
            const error = new Error('The operation was aborted due to timeout')
            error.name = 'TimeoutError'
            return Promise.reject(error)
        })
        vi.stubGlobal('fetch', fetchMock)
        try {
            await expect(
                requestWeiboJson({ url: 'https://weibo.com/ajax/slow', cookie: 'SUB=1', minIntervalMs: 0 }),
            ).rejects.toThrow('微博请求超时')
        } finally {
            vi.unstubAllGlobals()
        }
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })
})

describe('正文解析边界', () => {
    it('超长正文退化为纯文本，不再解析标签', () => {
        const html = `${'字'.repeat(20_000)}<a href="https://weibo.com/u/1">@作者</a>`
        const post = normalizeTimelinePost({ ...rawStatus('1'), text: html })
        expect(post).not.toBeNull()
        expect(post?.segments.some((segment) => segment.type === 'link')).toBe(false)
    })

    it('锚点不成对时不进入标签解析', () => {
        const html = '<a href="https://weibo.com/u/1">未闭合'.repeat(40)
        const post = normalizeTimelinePost({ ...rawStatus('2'), text: html })
        expect(post?.segments.every((segment) => segment.type !== 'link')).toBe(true)
    })
})

describe('时间线去重', () => {
    it('跨页重复条目计入 droppedDuplicates，结果保持首次出现的顺序', async () => {
        const firstPage: TimelinePage = {
            statuses: [rawStatus('1'), rawStatus('2')],
            sinceId: null,
            maxId: 'cursor-2',
        }
        const secondPage: TimelinePage = {
            statuses: [rawStatus('2'), rawStatus('3')],
            sinceId: null,
            maxId: null,
        }
        const result = await fetchFriendTimeline({
            cookie: 'SUB=1',
            maxPages: 2,
            requestPage: (query): Promise<TimelinePage> =>
                Promise.resolve(query.maxId === null ? firstPage : secondPage),
        })
        expect(result.posts.map((post) => post.id)).toEqual(['1', '2', '3'])
        expect(result.droppedDuplicates).toBe(1)
        expect(result.pages).toBe(2)
    })
})

describe('写操作互斥', () => {
    it('同一载荷的并发重复提交被拒绝，首个请求完成后放行', async () => {
        const gateRef: { release: (() => void) | null } = { release: null }
        const gate = new Promise<void>((resolve) => {
            gateRef.release = resolve
        })
        const routes = new WeiboRoutes({
            cookieStore: createCookieStore('SUB=1'),
            setLike: async (): Promise<WeiboLikeResult> => {
                await gate
                return { liked: true, attitudesCount: 1 }
            },
        })
        const payload = { id: '5001', liked: true }
        const first = routes.handle(WEIBO_METHODS.like, payload)
        await expect(routes.handle(WEIBO_METHODS.like, payload)).rejects.toThrow('相同的操作正在处理中')
        gateRef.release?.()
        await expect(first).resolves.toEqual({ liked: true, attitudesCount: 1 })
        // 闸门已释放：同一操作可以再次执行，时间窗去重不会误伤正常的连续点击
        await expect(routes.handle(WEIBO_METHODS.like, payload)).resolves.toBeDefined()
    })
})

describe('视频中转动向校验', () => {
    it('重定向到白名单外时不再发出第二跳', async () => {
        const fetchMock = vi.fn((): Promise<Response> =>
            Promise.resolve(new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:9/steal' } })),
        )
        vi.stubGlobal('fetch', fetchMock)
        try {
            const result = await fetchUpstream('https://f.video.weibocdn.com/a.mp4', 'GET', undefined)
            expect(result).toBeNull()
            expect(fetchMock).toHaveBeenCalledTimes(1)
        } finally {
            vi.unstubAllGlobals()
        }
    })

    it('白名单内的重定向会被跟随', async () => {
        const fetchMock = vi.fn((url: string): Promise<Response> => {
            if (url.endsWith('/a.mp4')) {
                return Promise.resolve(
                    new Response(null, {
                        status: 302,
                        headers: { location: 'https://f.video.weibocdn.com/b.mp4' },
                    }),
                )
            }
            return Promise.resolve(new Response('ok', { status: 200, headers: { 'content-type': 'video/mp4' } }))
        })
        vi.stubGlobal('fetch', fetchMock)
        try {
            const result = await fetchUpstream('https://f.video.weibocdn.com/a.mp4', 'GET', undefined)
            expect(result?.status).toBe(200)
            expect(fetchMock).toHaveBeenCalledTimes(2)
        } finally {
            vi.unstubAllGlobals()
        }
    })
})

/** 内存缓存替身：只用于观察是否写入冷却时刻 */
function createMemoryCache(): { cache: WeiboCache; warmed: string[] } {
    const warmed: string[] = []
    return {
        warmed,
        cache: {
            readGroups: (): Promise<null> => Promise.resolve(null),
            readHotRank: (): Promise<null> => Promise.resolve(null),
            readEmoticons: (): Promise<null> => Promise.resolve(null),
            readProfile: (): Promise<null> => Promise.resolve(null),
            write: (): Promise<void> => Promise.resolve(),
            readWarmedAt: (): Promise<null> => Promise.resolve(null),
            markWarmed: (accountKey: string): Promise<void> => {
                warmed.push(accountKey)
                return Promise.resolve()
            },
            clear: (): Promise<void> => Promise.resolve(),
        },
    }
}

describe('设备指纹', () => {
    it('同账号稳定、跨账号不同，形态仍是 33 位且首位为 0', () => {
        const first = buildStableFingerprint('SUB=token-a')
        const again = buildStableFingerprint('SUB=token-a')
        const other = buildStableFingerprint('SUB=token-b')
        expect(first).toBe(again)
        expect(first).not.toBe(other)
        expect(first).toMatch(/^0[A-Za-z0-9]{32}$/u)
    })
})

describe('视频地址结果', () => {
    it('带上可否拖动标记；中转不可用时回落 null 与不可拖动', async () => {
        const routes = new WeiboRoutes({
            cookieStore: createCookieStore('SUB=1'),
            resolveVideoUrl: (): Promise<{ url: string; seekable: boolean }> =>
                Promise.resolve({ url: 'http://127.0.0.1:9/video?url=a&t=b', seekable: false }),
        })
        await expect(
            routes.handle(WEIBO_METHODS.video, { url: 'https://f.video.weibocdn.com/a.mp4' }),
        ).resolves.toEqual({ url: 'http://127.0.0.1:9/video?url=a&t=b', seekable: false })

        const disabled = new WeiboRoutes({ cookieStore: createCookieStore('SUB=1') })
        await expect(
            disabled.handle(WEIBO_METHODS.video, { url: 'https://f.video.weibocdn.com/a.mp4' }),
        ).resolves.toEqual({ url: null, seekable: false })
    })
})

describe('视频显示时长', () => {
    it('metadata 时长偏小时用上游声明值兜底', () => {
        expect(resolveVideoDisplayDuration(3, 125, 0)).toBe(125)
    })

    it('metadata 为 Infinity 时用上游声明值', () => {
        expect(resolveVideoDisplayDuration(Number.POSITIVE_INFINITY, 62, 0)).toBe(62)
    })

    it('没有任何可信时长时至少不小于当前播放位置', () => {
        expect(resolveVideoDisplayDuration(Number.NaN, null, 18)).toBe(18)
    })

    it('metadata 可信时优先采用它', () => {
        expect(resolveVideoDisplayDuration(90, 88, 12)).toBe(90)
    })
})

describe('预热冷却', () => {
    it('全部失败或跳过后不记冷却，下次激活仍会重试', async () => {
        const { cache, warmed } = createMemoryCache()
        const failure = (): Promise<never> => Promise.reject(new Error('网络不可用'))
        await warmWeiboMetadata({
            cookieStore: createCookieStore('SUB=1'),
            cache,
            fetchGroups: failure,
            fetchHotRank: failure,
            fetchEmoticons: failure,
        })
        expect(warmed).toHaveLength(0)
    })

    it('至少一项取到数据才记冷却', async () => {
        const { cache, warmed } = createMemoryCache()
        const failure = (): Promise<never> => Promise.reject(new Error('网络不可用'))
        await warmWeiboMetadata({
            cookieStore: createCookieStore('SUB=1'),
            cache,
            fetchGroups: (): Promise<WeiboGroupsResult> =>
                Promise.resolve({
                    defaultGroups: [],
                    myGroups: [],
                    hotChannels: [],
                    timelineListId: null,
                    uid: '9001',
                }),
            fetchProfile: (): Promise<WeiboProfile> =>
                Promise.resolve({
                    id: '9001',
                    name: '测试作者',
                    avatarUrl: '',
                    isVerified: false,
                    description: '',
                    followersCount: 0,
                    friendsCount: 0,
                    statusesCount: 0,
                }),
            fetchHotRank: failure,
            fetchEmoticons: failure,
        })
        expect(warmed).toHaveLength(1)
    })
})
