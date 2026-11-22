/**
 * 发布链路的纯函数与整体流程：图床地址、pid 解析、发布表单、结果解析、指纹与「传图 → 发布」串联。
 * 复用约定：不触网，fetcher 由用例注入；断言只针对参数拼装与回包收窄。
 * 关键约束：图床走 pic_upload.php（无签名参数），参数与字段名改动即视为接口变更，需同步 docs/modules/weibo.md。
 */
import { describe, expect, it } from 'vitest'
import {
    buildPublishForm,
    buildUploadUrl,
    buildWeiboFingerprint,
    publishWeibo,
    readPidFromUpload,
    readPublishResult,
} from '@modules/weibo/api/write/publish'
import { WeiboWebError } from '@modules/weibo/transport/httpClient'

describe('buildUploadUrl', () => {
    it('指向 pic_upload.php，参数固定且不带 cs', () => {
        const url = new URL(buildUploadUrl('image/png'))
        expect(url.origin).toBe('https://picupload.weibo.com')
        expect(url.pathname).toBe('/interface/pic_upload.php')
        expect(url.searchParams.get('s')).toBe('json')
        expect(url.searchParams.get('ori')).toBe('1')
        expect(url.searchParams.get('data')).toBe('1')
        expect(url.searchParams.get('rotate')).toBe('0')
        expect(url.searchParams.get('wm')).toBe('')
        expect(url.searchParams.get('app')).toBe('miniblog')
        expect(url.searchParams.get('mime')).toBe('image/png')
        expect(url.searchParams.has('cs')).toBe(false)
    })
})

describe('readPidFromUpload', () => {
    it('从 data.pics.pic_1.pid 取 pid', () => {
        expect(readPidFromUpload({ code: 'A00006', data: { pics: { pic_1: { pid: 'pid-1' } } } })).toBe('pid-1')
    })

    it('兼容 pic.pid、data.pid 与顶层 pid', () => {
        expect(readPidFromUpload({ code: 'A00006', pic: { pid: 'pid-2' } })).toBe('pid-2')
        expect(readPidFromUpload({ code: 'A00006', data: { pid: 'pid-3' } })).toBe('pid-3')
        expect(readPidFromUpload({ code: 'A00006', pid: 'pid-4' })).toBe('pid-4')
    })

    it('没有 pid 时报错，并把 code / 字段名 / 原文摘要带进错误', () => {
        try {
            readPidFromUpload({ code: 'A20001' }, '{"code":"A20001"}')
            expect.unreachable('应当抛错')
        } catch (error) {
            expect(error).toBeInstanceOf(WeiboWebError)
            const message = (error as WeiboWebError).message
            expect(message).toContain('code=A20001')
            expect(message).toContain('字段=code')
            expect(message).toContain('原文={"code":"A20001"}')
        }
    })

    it('上游带 msg 时优先展示该文案', () => {
        expect(() => readPidFromUpload({ code: 'A20001', msg: '文件过大' })).toThrow('图片上传失败：文件过大')
    })
})

describe('buildPublishForm', () => {
    it('有图时 pic_id 是 type/pid 的 JSON 串，空字段保留', () => {
        const form = buildPublishForm({
            content: '#使命召唤手游# ',
            pics: [{ type: 'image/png', pid: '006SKQTMgy1ij9x9i6st8j309p0853zi' }],
            fingerprint: '02AU5WnuhwDdY3f1Q2yge5g6fH0S1X',
        })
        expect(form.get('content')).toBe('#使命召唤手游# ')
        expect(form.get('visible')).toBe('0')
        expect(form.get('share_id')).toBe('')
        expect(form.get('vote')).toBe('')
        expect(form.get('media')).toBe('')
        expect(form.get('need_transcode')).toBe('1')
        expect(JSON.parse(form.get('pic_id') ?? '[]')).toEqual([
            { type: 'image/png', pid: '006SKQTMgy1ij9x9i6st8j309p0853zi' },
        ])
        expect(form.get('fp')).toBe('02AU5WnuhwDdY3f1Q2yge5g6fH0S1X')
    })

    it('无图时 pic_id 为空串', () => {
        const form = buildPublishForm({ content: '只有文字', pics: [], fingerprint: '0' })
        expect(form.get('pic_id')).toBe('')
    })
})

describe('readPublishResult', () => {
    it('取出 id / mblogid 并按 uid 拼原文地址', () => {
        const result = readPublishResult({
            ok: 1,
            data: {
                id: 5367738161169096,
                idstr: '5367738161169096',
                mblogid: 'Rsqb64U8o',
                user: { idstr: '6305885570' },
            },
        })
        expect(result.id).toBe('5367738161169096')
        expect(result.mblogid).toBe('Rsqb64U8o')
        expect(result.url).toBe('https://weibo.com/6305885570/Rsqb64U8o')
        // 上游返回的就是完整微博：归一化后可交给前端前插，不必刷新时间线
        expect(result.post?.id).toBe('5367738161169096')
    })

    it('缺 uid 时回落 detail 地址', () => {
        const result = readPublishResult({ ok: 1, data: { idstr: '1', mblogid: 'Abc' } })
        expect(result.url).toBe('https://weibo.com/detail/1')
    })

    it('ok 为 0 时按文案分类报错', () => {
        expect(() => readPublishResult({ ok: 0, msg: '操作太频繁' })).toThrow('发布失败：操作太频繁')
        try {
            readPublishResult({ ok: 0, msg: '操作太频繁' })
        } catch (error) {
            expect(error).toBeInstanceOf(WeiboWebError)
            expect((error as WeiboWebError).code).toBe('rate-limited')
        }
    })

    it('缺 mblogid 时判结构异常', () => {
        expect(() => readPublishResult({ ok: 1, data: { idstr: '1' } })).toThrow('缺少微博 id 或 mblogid')
    })
})

describe('指纹', () => {
    it('为 33 位且首位固定 0，字符都在字母表内', () => {
        const fingerprint = buildWeiboFingerprint(() => 0.42)
        expect(fingerprint).toHaveLength(33)
        expect(fingerprint.startsWith('0')).toBe(true)
        expect(/^[0-9A-Za-z]+$/u.test(fingerprint)).toBe(true)
    })
})

describe('publishWeibo 流程', () => {
    it('先传图换 pid，再用该 pid 发布', async () => {
        const uploadBodies: string[] = []
        const publishBodies: string[] = []
        const fetcher: typeof fetch = (input, init) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
            if (url.includes('/interface/pic_upload.php')) {
                const isForm = init?.body instanceof FormData
                uploadBodies.push(isForm ? 'form' : (new Headers(init?.headers).get('Content-Type') ?? ''))
                return Promise.resolve(
                    new Response(JSON.stringify({ code: 'A00006', data: { pics: { pic_1: { pid: 'pid-upload' } } } }), {
                        status: 200,
                    }),
                )
            }
            const body = init?.body
            publishBodies.push(typeof body === 'string' ? body : body instanceof URLSearchParams ? body.toString() : '')
            return Promise.resolve(
                new Response(JSON.stringify({ ok: 1, data: { idstr: '1', mblogid: 'Abc', user: { idstr: '9' } } }), {
                    status: 200,
                }),
            )
        }
        const result = await publishWeibo({
            cookie: 'SUB=demo',
            content: 'hello',
            images: [{ bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' }],
            fetcher,
            random: () => 0.5,
        })
        expect(result.mblogid).toBe('Abc')
        expect(uploadBodies).toEqual(['application/octet-stream'])
        expect(publishBodies[0]).toContain('pid-upload')
    })

    it('图床上传失败时整条放弃，不发发布请求', async () => {
        const publishBodies: string[] = []
        const fetcher: typeof fetch = (input, init) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
            if (url.includes('/interface/pic_upload.php')) {
                return Promise.resolve(
                    new Response('<!DOCTYPE html><html><head><title>404 Not Found</title></head></html>', {
                        status: 200,
                    }),
                )
            }
            const body = init?.body
            publishBodies.push(typeof body === 'string' ? body : body instanceof URLSearchParams ? body.toString() : '')
            return Promise.resolve(new Response('{}', { status: 200 }))
        }
        await expect(
            publishWeibo({
                cookie: 'SUB=demo',
                content: 'hello',
                images: [{ bytes: new Uint8Array([1]), mimeType: 'image/png' }],
                fetcher,
                random: () => 0.5,
            }),
        ).rejects.toThrow('返回了 HTML 页面')
        expect(publishBodies).toHaveLength(0)
    })
})
