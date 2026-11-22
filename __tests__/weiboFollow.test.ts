/**
 * 博主关注：端点、参数形状与成功判定。
 * 重点锁住四件事——关注走 friendships/create 且只提交 friend_uid 与固定来源参数，
 * 取关走 friendships/destory 只提交 uid；结果一律按目标状态回传（上游回包的 following 不可信）；
 * ok=0 属业务失败并可按文案归为限流码。
 * 全部为纯逻辑用例：fetch 由替身接住，不触网、不依赖 Cookie 真实值。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setAuthorFollow } from '../src/modules/weibo/webInteraction'

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

describe('setAuthorFollow', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('关注：走 friendships/create，form 带 friend_uid 与固定来源参数', async () => {
        // 上游关注回包实测仍带 following: false，结果必须以目标状态为准
        const outcome = installFetchMock({ ok: 1, id: 6236859649, following: false })
        const result = await setAuthorFollow({
            cookie: 'SUB=token; XSRF-TOKEN=abc',
            uid: '6236859649',
            following: true,
        })
        expect(outcome.urls).toEqual(['https://weibo.com/ajax/friendships/create'])
        const form = outcome.forms[0] ?? new URLSearchParams()
        expect([...form.keys()]).toEqual(['friend_uid', 'uicode', 'fid', 'page'])
        expect(form.get('friend_uid')).toBe('6236859649')
        expect(outcome.headers[0]).toMatchObject({ 'X-XSRF-TOKEN': 'abc' })
        expect(result.following).toBe(true)
    })

    it('取消关注：走 friendships/destory，form 只带 uid', async () => {
        const outcome = installFetchMock({ ok: 1, id: 6236859649, following: false })
        const result = await setAuthorFollow({ cookie: 'SUB=token', uid: '6236859649', following: false })
        expect(outcome.urls).toEqual(['https://weibo.com/ajax/friendships/destory'])
        const form = outcome.forms[0] ?? new URLSearchParams()
        expect([...form.keys()]).toEqual(['uid'])
        expect(form.get('uid')).toBe('6236859649')
        expect(result.following).toBe(false)
    })

    it('回包不带 following 时按目标状态回传', async () => {
        installFetchMock({ ok: 1 })
        const result = await setAuthorFollow({ cookie: 'SUB=token', uid: '6236859649', following: true })
        expect(result.following).toBe(true)
    })

    it('取关回包带 following: true 时仍按目标状态回传', async () => {
        installFetchMock({ ok: 1, following: true })
        const result = await setAuthorFollow({ cookie: 'SUB=token', uid: '6236859649', following: false })
        expect(result.following).toBe(false)
    })

    it('ok=0 属业务失败，含「频繁」时归为限流码', async () => {
        installFetchMock({ ok: 0, msg: '操作频繁，请稍后再试' })
        await expect(
            setAuthorFollow({ cookie: 'SUB=token', uid: '6236859649', following: true }),
        ).rejects.toMatchObject({ code: 'rate-limited' })
    })
})
