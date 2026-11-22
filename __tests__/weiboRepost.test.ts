/**
 * 转发提交参数：三种方式的表单字段与网页端实测保持一致，重点防 is_repost / is_comment 写反。
 * 「评论并转发」是一次请求——comments/create 带 is_repost=1 由上游同时生成评论与转发（回包 data.repostId），
 * 用例把这个参数与「回包缺 repostId 时按部分成功」一起锁住。
 * 全部为纯逻辑用例：fetch 由替身接住，不触网、不依赖 Cookie 真实值。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WeiboRepostCreateResult, WeiboRepostMode } from '@shared/types/weibo'
import { createPostRepost } from '../src/modules/weibo/reposts/write'

/** 拦下 fetch：记录每次请求的地址与表单，按传入的回包返回 */
function installFetchMock(payload: Record<string, unknown> = { ok: 1, msg: '转发成功' }): {
    urls: string[]
    forms: URLSearchParams[]
} {
    const urls: string[] = []
    const forms: URLSearchParams[] = []
    vi.stubGlobal(
        'fetch',
        vi.fn((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
            urls.push(url)
            forms.push(new URLSearchParams(typeof init?.body === 'string' ? init.body : ''))
            return Promise.resolve(
                new Response(JSON.stringify(payload), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                }),
            )
        }),
    )
    return { urls, forms }
}

/** 提交一次转发，返回被拦下的全部请求与回包 */
async function submit(
    mode: WeiboRepostMode,
    comment: string,
    payload?: Record<string, unknown>,
): Promise<{ urls: string[]; forms: URLSearchParams[]; result: WeiboRepostCreateResult }> {
    const { urls, forms } = installFetchMock(payload)
    const result = await createPostRepost({
        cookie: 'SUB=token; XSRF-TOKEN=abc',
        id: '5367759501266671',
        comment,
        mode,
        random: () => 0,
    })
    return { urls, forms, result }
}

describe('createPostRepost', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('只转发：一个转发请求，is_repost 与 is_comment 都是 0，带 visible 与 share_id', async () => {
        const { urls, forms } = await submit('repost', '')
        expect(urls).toEqual(['https://weibo.com/ajax/statuses/normal_repost'])
        const form = forms[0] ?? new URLSearchParams()
        expect(form.get('id')).toBe('5367759501266671')
        expect(form.get('comment')).toBe('')
        expect(form.get('pic_id')).toBe('')
        expect(form.get('is_repost')).toBe('0')
        expect(form.get('comment_ori')).toBe('0')
        expect(form.get('is_comment')).toBe('0')
        expect(form.get('visible')).toBe('0')
        expect(form.get('share_id')).toBe('')
        // 设备指纹：33 位、首位固定 0，与网页端同形
        expect(form.get('fp')).toHaveLength(33)
        expect(form.get('fp')?.startsWith('0')).toBe(true)
    })

    it('转发并评论：一个请求，is_comment 为 1，仍带 visible 与 share_id', async () => {
        const { urls, forms } = await submit('repostWithComment', '[心]')
        expect(urls).toEqual(['https://weibo.com/ajax/statuses/normal_repost'])
        const form = forms[0] ?? new URLSearchParams()
        expect(form.get('comment')).toBe('[心]')
        expect(form.get('is_repost')).toBe('0')
        expect(form.get('is_comment')).toBe('1')
        expect(form.get('visible')).toBe('0')
        expect(form.get('share_id')).toBe('')
    })

    it('评论并转发：一个 comments/create 请求，is_repost=1 由上游同时生成转发', async () => {
        const { urls, forms, result } = await submit('commentWithRepost', '[心][心][心]', {
            ok: 1,
            msg: '评论成功',
            data: { id: 5368268200346202, repostId: 5368268204539918 },
        })
        expect(urls).toEqual(['https://weibo.com/ajax/comments/create'])
        const form = forms[0] ?? new URLSearchParams()
        expect(form.get('comment')).toBe('[心][心][心]')
        expect(form.get('is_repost')).toBe('1')
        expect(form.get('is_comment')).toBe('0')
        expect(form.has('visible')).toBe(false)
        expect(form.has('share_id')).toBe(false)
        expect(result).toEqual({ reposted: true, commented: true })
    })

    it('评论并转发：回包缺 repostId 时按部分成功返回，避免重试把评论发重', async () => {
        const { urls, result } = await submit('commentWithRepost', '测试', { ok: 1, msg: '评论成功' })
        expect(urls).toEqual(['https://weibo.com/ajax/comments/create'])
        expect(result.reposted).toBe(false)
        expect(result.commented).toBe(true)
        expect(result.failureMessage).toContain('转发未生成')
    })
})
