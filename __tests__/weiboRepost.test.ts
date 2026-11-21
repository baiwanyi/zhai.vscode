/**
 * 转发提交参数：三种方式的表单字段与网页端实测保持一致，重点防 is_repost / is_comment 写反。
 * 「评论并转发」在网页端是两个请求——先 comments/create 发评论，再 normal_repost（is_repost=1）转发，
 * 单靠 normal_repost 不会生成评论，用例把这个顺序与两个表单一起锁住。
 * 全部为纯逻辑用例：fetch 由替身接住，不触网、不依赖 Cookie 真实值。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WeiboRepostMode } from '@shared/types/weibo'
import { createPostRepost } from '../src/modules/weibo/webReposts'

/** 拦下 fetch：记录每次请求的地址与表单，回一个固定的成功回包 */
function installFetchMock(): { urls: string[]; forms: URLSearchParams[] } {
    const urls: string[] = []
    const forms: URLSearchParams[] = []
    vi.stubGlobal(
        'fetch',
        vi.fn((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
            urls.push(url)
            forms.push(new URLSearchParams(typeof init?.body === 'string' ? init.body : ''))
            return Promise.resolve(
                new Response(JSON.stringify({ ok: 1, msg: '转发成功' }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                }),
            )
        }),
    )
    return { urls, forms }
}

/** 提交一次转发，返回被拦下的全部请求 */
async function submit(mode: WeiboRepostMode, comment: string): Promise<{ urls: string[]; forms: URLSearchParams[] }> {
    const { urls, forms } = installFetchMock()
    await createPostRepost({
        cookie: 'SUB=token; XSRF-TOKEN=abc',
        id: '5367759501266671',
        comment,
        mode,
        random: () => 0,
    })
    return { urls, forms }
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

    it('评论并转发：先发评论再转发，转发带 is_repost=1 且不带 visible 与 share_id', async () => {
        const { urls, forms } = await submit('commentWithRepost', '[心][心][心]')
        expect(urls).toEqual([
            'https://weibo.com/ajax/comments/create',
            'https://weibo.com/ajax/statuses/normal_repost',
        ])

        const commentForm = forms[0] ?? new URLSearchParams()
        expect(commentForm.get('comment')).toBe('[心][心][心]')
        expect(commentForm.get('is_repost')).toBe('0')
        expect(commentForm.get('is_comment')).toBe('0')

        const repostForm = forms[1] ?? new URLSearchParams()
        expect(repostForm.get('comment')).toBe('[心][心][心]')
        expect(repostForm.get('is_repost')).toBe('1')
        expect(repostForm.get('is_comment')).toBe('0')
        expect(repostForm.has('visible')).toBe(false)
        expect(repostForm.has('share_id')).toBe(false)
    })

    it('评论并转发：第二步失败时返回部分结果而不抛错，避免重试把评论发重', async () => {
        let call = 0
        vi.stubGlobal(
            'fetch',
            vi.fn((): Promise<Response> => {
                call += 1
                const payload = call === 1 ? { ok: 1, msg: '评论成功' } : { ok: 0, msg: '转发太快' }
                return Promise.resolve(
                    new Response(JSON.stringify(payload), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' },
                    }),
                )
            }),
        )
        const result = await createPostRepost({
            cookie: 'SUB=token',
            id: '5367759501266671',
            comment: '测试',
            mode: 'commentWithRepost',
            random: () => 0,
        })
        expect(result.reposted).toBe(false)
        expect(result.commented).toBe(true)
        expect(result.failureMessage).toContain('转发失败')
    })
})
