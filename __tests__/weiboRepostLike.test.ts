/**
 * 转发点赞：端点、参数形状与成功判定。
 * 重点锁住三件事——点赞走 setLike 且带 id + 设备指纹，取消走 cancelLike 只带 id，
 * 点赞回包从根层 status 取最新计数；ok=0 属业务失败。
 * 全部为纯逻辑用例：fetch 由替身接住，不触网、不依赖 Cookie 真实值。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setRepostLike } from '../src/modules/weibo/api/write/interaction'
import { buildStableFingerprint } from '../src/modules/weibo/api/write/publish'

/** random 恒为 0 时的指纹：字符集首位是 '0'，长度为网页端的 33 位 */
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

describe('setRepostLike', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('点赞：走 setLike，form 带 id 与稳定指纹', async () => {
        const outcome = installFetchMock({ ok: 1, status: { attitudes_count: 8 } })
        const result = await setRepostLike({
            cookie: COOKIE,
            id: '5368144232191355',
            liked: true,
        })
        expect(outcome.urls).toEqual(['https://weibo.com/ajax/statuses/setLike'])
        const form = outcome.forms[0] ?? new URLSearchParams()
        expect(form.get('id')).toBe('5368144232191355')
        // 指纹由 Cookie 派生：33 位、首位 0，同账号两次请求完全一致
        const fingerprint = form.get('fp') ?? ''
        expect(fingerprint).toMatch(/^0[A-Za-z0-9]{32}$/u)
        expect(fingerprint).toBe(buildStableFingerprint(COOKIE))
        expect(outcome.headers[0]).toMatchObject({ 'X-XSRF-TOKEN': 'abc' })
        expect(result.liked).toBe(true)
        expect(result.attitudesCount).toBe(8)
    })

    it('取消点赞：走 cancelLike，只带 id', async () => {
        const outcome = installFetchMock({ result: true, ok: 1 })
        const result = await setRepostLike({
            cookie: 'SUB=token',
            id: '5368144232191355',
            liked: false,
            random: () => 0,
        })
        expect(outcome.urls).toEqual(['https://weibo.com/ajax/statuses/cancelLike'])
        const form = outcome.forms[0] ?? new URLSearchParams()
        expect([...form.keys()]).toEqual(['id'])
        expect(result.liked).toBe(false)
        expect(result.attitudesCount).toBeNull()
    })

    it('ok=0 属业务失败，含「过快」时归为限流码', async () => {
        installFetchMock({ ok: 0, msg: '操作过快，请稍后再试' })
        await expect(
            setRepostLike({ cookie: 'SUB=token', id: '5368144232191355', liked: true, random: () => 0 }),
        ).rejects.toMatchObject({ code: 'rate-limited' })
    })
})
