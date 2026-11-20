/**
 * 微博保存笔记的长文补全：主贴与转发体被上游截断时先取全文，取不到则保留摘要。
 * 全部为纯逻辑用例：Cookie、长文接口与落盘回调都由用例注入替身，不触网、不写盘。
 * 断言只看落盘回调收到的载荷（正文是否为全文、截断标记是否复位）与长文接口实际请求的 id。
 */
import { describe, expect, it } from 'vitest'
import type { WeiboLongTextResult, WeiboNoteSaveResult, WeiboPagePostPayload } from '@shared/types/weibo'
import { WeiboRoutes } from '../src/modules/weibo/weiboRoutes'

/** 最小可用的 Cookie 存取器：只保证读到非空值，其余方法返回已完成的 Promise */
const cookieStore = {
    read: (): Promise<string | undefined> => Promise.resolve('SUB=token'),
    write: (): Promise<void> => Promise.resolve(),
    remove: (): Promise<void> => Promise.resolve(),
    readSavedAt: (): Promise<string | undefined> => Promise.resolve(undefined),
    writeSavedAt: (): Promise<void> => Promise.resolve(),
    removeSavedAt: (): Promise<void> => Promise.resolve(),
}

/** 构造一条最小可用的卡片载荷，用例按需覆盖字段 */
function createPayload(overrides: Partial<WeiboPagePostPayload> = {}): WeiboPagePostPayload {
    return {
        id: '5100000000000001',
        mblogid: 'Rsj8O8SqU',
        url: 'https://weibo.com/3793264344/Rsj8O8SqU',
        text: '这是一条测试微博',
        createdAt: '2026-11-20T23:07:10.000Z',
        author: { id: '3793264344', name: '墨嵐_Maura' },
        images: [],
        imageIds: [],
        videoUrl: null,
        retweeted: null,
        isTruncated: false,
        ...overrides,
    }
}

/** 长文接口替身：按用例给定的实现返回或抛错 */
type LongTextLoader = (id: string) => Promise<WeiboLongTextResult>

/**
 * 跑一次保存：返回落盘回调收到的载荷与长文接口请求过的 id。
 * 落盘结果用容器接住，避免 TS 把闭包内赋值当成未发生。
 */
async function runSave(
    payload: WeiboPagePostPayload,
    longText: LongTextLoader,
): Promise<{ saved: WeiboPagePostPayload; requested: string[] }> {
    const requested: string[] = []
    const captured: { post: WeiboPagePostPayload | null } = { post: null }
    const routes = new WeiboRoutes({
        cookieStore,
        fetchLongText: ({ id }): Promise<WeiboLongTextResult> => {
            requested.push(id)
            return longText(id)
        },
        saveToNote: (post): Promise<WeiboNoteSaveResult> => {
            captured.post = post
            return Promise.resolve({
                path: 'notes/未分类/微博-墨嵐_Maura-Rsj8O8SqU.md',
                title: '微博-墨嵐_Maura-Rsj8O8SqU',
                imageCount: 0,
            })
        },
    })
    await routes.handle('weibo/saveToNote', payload)
    const saved = captured.post
    if (saved === null) {
        throw new Error('saveToNote 未执行')
    }
    return { saved, requested }
}

describe('weibo/saveToNote 长文补全', () => {
    it('非长文不请求全文接口', async () => {
        const { saved, requested } = await runSave(createPayload(), (id) => Promise.resolve({ text: `全文:${id}` }))
        expect(requested).toEqual([])
        expect(saved.text).toBe('这是一条测试微博')
        expect(saved.isTruncated).toBe(false)
    })

    it('主贴被截断时按 mblogid 取全文并复位截断标记', async () => {
        const { saved, requested } = await runSave(createPayload({ isTruncated: true }), (id) =>
            Promise.resolve({ text: `全文:${id}` }),
        )
        expect(requested).toEqual(['Rsj8O8SqU'])
        expect(saved.text).toBe('全文:Rsj8O8SqU')
        expect(saved.isTruncated).toBe(false)
    })

    it('mblogid 缺失时用数字 id 取全文', async () => {
        const { requested } = await runSave(
            createPayload({ isTruncated: true, mblogid: '', url: 'https://weibo.com/detail/5100000000000001' }),
            (id) => Promise.resolve({ text: `全文:${id}` }),
        )
        expect(requested).toEqual(['5100000000000001'])
    })

    it('转发体被截断时按其数字 id 取全文，主贴未被截断则不请求', async () => {
        const { saved, requested } = await runSave(
            createPayload({
                retweeted: {
                    id: '5200000000000001',
                    authorName: '原作者',
                    text: '转发摘要',
                    images: [],
                    imageIds: [],
                    isTruncated: true,
                },
            }),
            (id) => Promise.resolve({ text: `全文:${id}` }),
        )
        expect(requested).toEqual(['5200000000000001'])
        expect(saved.retweeted?.text).toBe('全文:5200000000000001')
        expect(saved.retweeted?.isTruncated).toBe(false)
    })

    it('取全文失败时保留摘要并维持截断标记，不阻断保存', async () => {
        const { saved, requested } = await runSave(createPayload({ isTruncated: true }), () =>
            Promise.reject(new Error('网络不可用')),
        )
        expect(requested).toEqual(['Rsj8O8SqU'])
        expect(saved.text).toBe('这是一条测试微博')
        expect(saved.isTruncated).toBe(true)
    })
})
