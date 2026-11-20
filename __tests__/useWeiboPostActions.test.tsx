// @vitest-environment jsdom
/**
 * useWeiboPostActions 用例：校验卡片展示态到协议载荷的转换。
 * 复用约定：renderHook + bridge.request 替身，与其它 hook 用例同构；jsdom 环境由首行指令声明。
 * 关键约束：只断言请求载荷——卡片上已展开的主贴 / 转发全文必须随载荷带出并把 isTruncated 复位，
 * 未展开的长文则保留摘要并打上 isTruncated，交给宿主补全。
 */
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
    WeiboNoteSaveResult,
    WeiboPagePostPayload,
    WeiboTimelineMedia,
    WeiboTimelinePost,
    WeiboTimelineRetweet,
} from '@shared/types/weibo'
import { useWeiboPostActions } from '@webview/weibo/hooks/useWeiboPostActions'

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }))

vi.mock('@shared/utils/bridge', () => ({ request: requestMock }))
vi.mock('@shared/utils/error', () => ({ toastError: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }))

/** 空媒体：本文件只关心文本与截断标记，不涉及配图搬运 */
const EMPTY_MEDIA: WeiboTimelineMedia = {
    items: [],
    images: [],
    imageIds: [],
    thumbnails: [],
    sizes: [],
    videoUrl: null,
    imageCount: 0,
    videoCount: 0,
}

const SAVE_RESULT: WeiboNoteSaveResult = {
    path: 'notes/未分类/微博-墨嵐_Maura-Rsj8O8SqU.md',
    title: '微博-墨嵐_Maura-Rsj8O8SqU',
    imageCount: 0,
}

/** 构造一条长文卡片状态，用例按需覆盖正文与转发体 */
function createPost(overrides: Partial<WeiboTimelinePost> = {}): WeiboTimelinePost {
    return {
        id: '5100000000000001',
        mblogid: 'Rsj8O8SqU',
        url: 'https://weibo.com/3793264344/Rsj8O8SqU',
        text: '主贴摘要',
        segments: [{ type: 'text', text: '主贴摘要' }],
        createdAt: '2026-11-20T23:07:10.000Z',
        createdAtRaw: '11-20 23:07',
        source: '',
        author: {
            id: '3793264344',
            name: '墨嵐_Maura',
            avatarUrl: 'https://tvax1.sinaimg.cn/a.jpg',
            isVerified: false,
        },
        metrics: { reposts: 0, comments: 0, likes: 0 },
        media: EMPTY_MEDIA,
        retweeted: null,
        isLiked: false,
        isLongText: true,
        ...overrides,
    }
}

/** 构造一条被转发微博：长文标记与正文由用例覆盖 */
function createRetweet(overrides: Partial<WeiboTimelineRetweet> = {}): WeiboTimelineRetweet {
    return {
        id: '5200000000000001',
        authorId: '5200000099',
        authorName: '原作者',
        authorIsVerified: false,
        text: '转发摘要',
        segments: [{ type: 'text', text: '转发摘要' }],
        url: 'https://weibo.com/detail/5200000000000001',
        createdAt: '2026-11-20T22:00:00.000Z',
        createdAtRaw: '11-20 22:00',
        media: EMPTY_MEDIA,
        isLongText: true,
        ...overrides,
    }
}

/** 取保存请求的载荷：只认第一个参数位之后的请求体 */
function readPayload(call: unknown[] | undefined): WeiboPagePostPayload {
    const payload = call?.[1]
    if (typeof payload !== 'object' || payload === null) {
        throw new Error('未发出保存请求')
    }
    return payload as WeiboPagePostPayload
}

/** 跑一次保存：返回宿主实际收到的载荷 */
async function savePayload(
    post: WeiboTimelinePost,
    fullText: string | null,
    retweetedFullText: string | null = null,
): Promise<WeiboPagePostPayload> {
    requestMock.mockResolvedValueOnce(SAVE_RESULT)
    const { result } = renderHook(() => useWeiboPostActions(post, fullText, retweetedFullText))
    await act(async () => {
        result.current.saveToNote()
        // 让 request 的 then 在同一轮 act 内结算，避免测试收尾时出现未包裹的状态更新
        await Promise.resolve()
    })
    return readPayload(requestMock.mock.calls[0])
}

beforeEach(() => {
    requestMock.mockReset()
})

describe('useWeiboPostActions 载荷组装', () => {
    it('主贴未展开时长文只带摘要并标记截断', async () => {
        const payload = await savePayload(createPost(), null)
        expect(payload.text).toBe('主贴摘要')
        expect(payload.isTruncated).toBe(true)
    })

    it('主贴已展开时带全文并复位截断标记', async () => {
        const payload = await savePayload(createPost(), '主贴全文')
        expect(payload.text).toBe('主贴全文')
        expect(payload.isTruncated).toBe(false)
    })

    it('转发体未展开时只带摘要并标记截断', async () => {
        const payload = await savePayload(createPost({ retweeted: createRetweet() }), '主贴全文')
        expect(payload.retweeted?.text).toBe('转发摘要')
        expect(payload.retweeted?.isTruncated).toBe(true)
    })

    it('转发体已展开时带全文并复位截断标记', async () => {
        const payload = await savePayload(createPost({ retweeted: createRetweet() }), '主贴全文', '转发全文')
        expect(payload.retweeted?.text).toBe('转发全文')
        expect(payload.retweeted?.isTruncated).toBe(false)
    })
})
