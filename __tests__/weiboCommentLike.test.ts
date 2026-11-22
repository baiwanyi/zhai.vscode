/**
 * 评论点赞：端点、参数形状与成功判定。
 * 重点锁住三件事——点赞走 updateLike 且带 object_type=comment 与设备指纹，取消走 destroyLike 不带指纹，
 * 回包 ok=0 属业务失败；以及不回计数时 likeCount 为 null，避免前端把已有计数清零。
 * 全部为纯逻辑用例：fetch 由替身接住，不触网、不依赖 Cookie 真实值。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WeiboCommentLikeResult } from '@shared/types/weibo'
import { setCommentLike } from '../src/modules/weibo/api/write/interaction'
import { buildStableFingerprint } from '../src/modules/weibo/api/write/publish'

/** random 恒为 0 时的指纹：字符集首位是 '0'，长度与网页端一致的 33 位 */
const COOKIE = 'SUB=token; XSRF-TOKEN=abc'

interface FetchOutcome {
    urls: string[]
    forms: URLSearchParams[]
    headers: Array<RequestInit['headers']>
}

/** 拦下 fetch：记录请求地址、表单与请求头，回包由用例给定 */
function installFetchMock(body: Record<string, unknown>, status = 200): FetchOutcome {
    const urls: string[] = []
    const forms: URLSearchParams[] = []
    const headers: Array<RequestInit['headers']> = []
    vi.stubGlobal(
        'fetch',
        vi.fn((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
            const rawBody = init?.body
            const bodyText =
                typeof rawBody === 'string' ? rawBody : rawBody instanceof URLSearchParams ? rawBody.toString() : ''
            urls.push(url)
            forms.push(new URLSearchParams(bodyText))
            headers.push(init?.headers)
            return Promise.resolve(
                new Response(JSON.stringify(body), {
                    status,
                    headers: { 'Content-Type': 'application/json' },
                }),
            )
        }),
    )
    return { urls, forms, headers }
}

describe('setCommentLike', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('点赞：走 updateLike，带 object_id、object_type=comment 与稳定指纹', async () => {
        const outcome = installFetchMock({ ok: 1, result: true })
        await setCommentLike({
            cookie: COOKIE,
            cid: '5368103670121714',
            liked: true,
        })
        expect(outcome.urls).toEqual(['https://weibo.com/ajax/statuses/updateLike'])
        const form = outcome.forms[0] ?? new URLSearchParams()
        expect(form.get('object_id')).toBe('5368103670121714')
        expect(form.get('object_type')).toBe('comment')
        // 指纹由 Cookie 派生：33 位、首位 0，同账号两次请求完全一致
        const fingerprint = form.get('fp') ?? ''
        expect(fingerprint).toMatch(/^0[A-Za-z0-9]{32}$/u)
        expect(fingerprint).toBe(buildStableFingerprint(COOKIE))
        expect(outcome.headers[0]).toMatchObject({ 'X-XSRF-TOKEN': 'abc' })
    })

    it('取消点赞：走 destroyLike，只带 object_id 与 object_type', async () => {
        const outcome = installFetchMock({ ok: 1, result: true })
        await setCommentLike({
            cookie: 'SUB=token',
            cid: '5368103670121714',
            liked: false,
            random: () => 0,
        })
        expect(outcome.urls).toEqual(['https://weibo.com/ajax/statuses/destroyLike'])
        const form = outcome.forms[0] ?? new URLSearchParams()
        expect([...form.keys()].sort()).toEqual(['object_id', 'object_type'])
        expect(form.get('fp')).toBeNull()
    })

    it('只给 result: true 也算成功，且缺少计数时 likeCount 为 null', async () => {
        installFetchMock({ result: true, ok: 1 })
        const result: WeiboCommentLikeResult = await setCommentLike({
            cookie: 'SUB=token',
            cid: '5368103670121714',
            liked: true,
            random: () => 0,
        })
        expect(result.liked).toBe(true)
        expect(result.likeCount).toBeNull()
    })

    it('回包带 like_counts 时回传最新计数', async () => {
        installFetchMock({ ok: 1, data: { like_counts: 12 } })
        const result = await setCommentLike({
            cookie: 'SUB=token',
            cid: '5368103670121714',
            liked: true,
            random: () => 0,
        })
        expect(result.likeCount).toBe(12)
    })

    it('ok=0 属业务失败，含「过快」时归为限流码', async () => {
        installFetchMock({ ok: 0, msg: '操作过快，请稍后再试' })
        await expect(
            setCommentLike({ cookie: 'SUB=token', cid: '5368103670121714', liked: true, random: () => 0 }),
        ).rejects.toMatchObject({ code: 'rate-limited' })
    })
})
