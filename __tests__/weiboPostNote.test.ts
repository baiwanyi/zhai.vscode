/**
 * 微博剪藏的单元测试：覆盖卡片载荷收窄、笔记 Markdown 组装与 AI 上下文文本。
 * 全部为纯函数用例，不触网、不写盘、不依赖 vscode：夹具直接构造卡片展示字段。
 * 断言只针对可观察结果（Frontmatter 键、正文段落、截断标注与过滤后的媒体），不绑定内部实现。
 */
import { describe, expect, it } from 'vitest'
import type { WeiboPagePostPayload } from '@shared/types/weibo'
import { readWeiboPagePost } from '@shared/types/weibo'
import { buildWeiboChatText, buildWeiboNoteMarkdown, buildWeiboNoteTitle } from '../src/modules/weibo/app/note'

/** 构造一条最小可用的卡片载荷，用例按需覆盖字段 */
function createPost(overrides: Partial<WeiboPagePostPayload> = {}): WeiboPagePostPayload {
    return {
        id: '5100000000000001',
        mblogid: 'Pabc123',
        url: 'https://weibo.com/1234567890/Pabc123',
        text: '这是一条测试微博',
        createdAt: '2026-11-20T10:30:00.000Z',
        author: { id: '1234567890', name: '测试作者' },
        images: [],
        imageIds: [],
        videoUrl: null,
        retweeted: null,
        isTruncated: false,
        ...overrides,
    }
}

describe('readWeiboPagePost', () => {
    it('收窄合法载荷并保留展示字段', () => {
        const result = readWeiboPagePost(createPost())
        expect(result).not.toBeNull()
        expect(result?.text).toBe('这是一条测试微博')
        expect(result?.author.name).toBe('测试作者')
        expect(result?.isTruncated).toBe(false)
    })

    it('拒绝非 https 的原文链接', () => {
        expect(readWeiboPagePost(createPost({ url: 'http://weibo.com/1234567890/Pabc123' }))).toBeNull()
    })

    it('拒绝非微博主站域名的链接', () => {
        expect(readWeiboPagePost(createPost({ url: 'https://evil.example.com/1234567890/Pabc123' }))).toBeNull()
    })

    it('拒绝非法 mblogid', () => {
        expect(readWeiboPagePost(createPost({ mblogid: '短' }))).toBeNull()
    })

    it('短 id 缺失时仍接受载荷（原文地址已回退 detail 链接）', () => {
        const result = readWeiboPagePost(createPost({ mblogid: '', url: 'https://weibo.com/detail/5100000000000001' }))
        expect(result?.mblogid).toBe('')
        expect(result?.url).toBe('https://weibo.com/detail/5100000000000001')
    })

    it('正文超长时截断并标注', () => {
        const result = readWeiboPagePost(createPost({ text: 'a'.repeat(20_100) }))
        expect(result?.text.length).toBe(20_000)
        expect(result?.isTruncated).toBe(true)
    })

    it('配图 pid 与直链保持同序，非法 pid 置空串', () => {
        const result = readWeiboPagePost(
            createPost({
                images: ['https://img.example.com/1.jpg', 'https://img.example.com/2.jpg'],
                imageIds: ['006ABCdef1234567', 'bad pid'],
            }),
        )
        expect(result?.imageIds).toEqual(['006ABCdef1234567', ''])
    })

    it('直链被过滤时对应 pid 一并丢弃，不错位', () => {
        const result = readWeiboPagePost(
            createPost({
                images: ['http://img.example.com/1.jpg', 'https://img.example.com/2.jpg'],
                imageIds: ['006ABCdef1234567', '006ABCdef7654321'],
            }),
        )
        expect(result?.images).toEqual(['https://img.example.com/2.jpg'])
        expect(result?.imageIds).toEqual(['006ABCdef7654321'])
    })

    it('转发体配图同样收窄，非法直链与对应 pid 一起丢弃', () => {
        const result = readWeiboPagePost(
            createPost({
                retweeted: {
                    id: '5200000000000001',
                    authorName: '原作者',
                    text: '原微博正文',
                    images: ['https://img.example.com/r1.jpg', 'http://img.example.com/r2.jpg'],
                    imageIds: ['006ABCdef7654321', '006ABCdef1111111'],
                    isTruncated: false,
                },
            }),
        )
        expect(result?.retweeted?.images).toEqual(['https://img.example.com/r1.jpg'])
        expect(result?.retweeted?.imageIds).toEqual(['006ABCdef7654321'])
    })

    it('配图只保留 https 直链且最多 9 张', () => {
        const images = [
            'http://img.example.com/1.jpg',
            ...Array.from({ length: 12 }, (_, index) => `https://img.example.com/${String(index)}.jpg`),
        ]
        const result = readWeiboPagePost(createPost({ images }))
        expect(result?.images).toHaveLength(9)
        expect(result?.images.every((image) => image.startsWith('https://'))).toBe(true)
    })
})

describe('buildWeiboNoteMarkdown', () => {
    it('正文不足 18 字时标题完整使用、不加省略号', () => {
        const markdown = buildWeiboNoteMarkdown(createPost())
        expect(markdown.startsWith('# 微博-这是一条测试微博\n')).toBe(true)
        expect(markdown).not.toContain('title:')
        expect(markdown).not.toContain('tags:')
        expect(markdown).not.toContain('source:')
        expect(markdown).toContain('> 作者：测试作者')
        expect(markdown).not.toContain('> UID：')
        expect(markdown).not.toContain('> PID：')
        expect(markdown).toContain('> 原文：[微博链接](https://weibo.com/1234567890/Pabc123)')
        expect(markdown).toMatch(/\n> 发表时间：\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\n/u)
        expect(markdown).toContain('> 采集方式：微博浏览器 · 保存为笔记')
        expect(markdown).toContain('## 微博正文\n\n这是一条测试微博')
    })

    it('正文正好 18 字时也不加省略号', () => {
        const markdown = buildWeiboNoteMarkdown(createPost({ text: '一二三四五六七八九十一二三四五六七八' }))
        expect(markdown.startsWith('# 微博-一二三四五六七八九十一二三四五六七八\n')).toBe(true)
    })

    it('正文超过 18 字时标题只取前 18 字，完整正文仍在正文段', () => {
        const markdown = buildWeiboNoteMarkdown(createPost({ text: '一二三四五六七八九十一二三四五六七八九十' }))
        expect(markdown.startsWith('# 微博-一二三四五六七八九十一二三四五六七八...\n')).toBe(true)
        expect(markdown).toContain('## 微博正文\n\n一二三四五六七八九十一二三四五六七八九十')
    })

    it('多行正文完整进正文段，标题折成单行（不超过 18 字时不截断）', () => {
        const markdown = buildWeiboNoteMarkdown(createPost({ text: '第一行标题\n第二行正文\n第三行正文' }))
        expect(markdown.startsWith('# 微博-第一行标题 第二行正文 第三行正文\n')).toBe(true)
        expect(markdown).toContain('## 微博正文\n\n第一行标题\n第二行正文\n第三行正文')
    })

    it('正文为空时标题回退「微博内容」且不加省略号', () => {
        const markdown = buildWeiboNoteMarkdown(createPost({ text: '' }))
        expect(markdown.startsWith('# 微博-微博内容\n')).toBe(true)
        expect(markdown).toContain('## 微博正文\n\n(无正文)')
    })

    it('作者名中的换行折成空格，不破坏引用块', () => {
        const markdown = buildWeiboNoteMarkdown(createPost({ author: { id: '1234567890', name: '换行\n作者' } }))
        expect(markdown).toContain('> 作者：换行 作者')
        expect(markdown).not.toContain('换行\n作者')
    })

    it('发表时间缺失时给出占位而不是当前时间', () => {
        const markdown = buildWeiboNoteMarkdown(createPost({ createdAt: '' }))
        expect(markdown).toContain('> 发表时间：未知时间')
    })

    it('无转发与配图时只有元信息后的一条分隔线', () => {
        const markdown = buildWeiboNoteMarkdown(createPost())
        const separators = markdown.split('\n').filter((line) => line === '---')
        expect(separators).toHaveLength(1)
        expect(markdown).not.toContain('## 转发内容')
        expect(markdown).not.toContain('## 微博配图')
    })

    it('转发配图也会写入笔记，并可用本地化引用', () => {
        const markdown = buildWeiboNoteMarkdown(
            createPost({
                retweeted: {
                    id: '5200000000000001',
                    authorName: '原作者',
                    text: '原微博正文',
                    images: ['https://img.example.com/r1.jpg'],
                    imageIds: ['006ABCdef7654321'],
                    isTruncated: false,
                },
            }),
            { retweetImages: ['uploads/202611/r1.jpg'] },
        )
        expect(markdown).toContain('### 转发配图')
        expect(markdown).toContain('![原作者 的配图](@zhai/uploads/202611/r1.jpg)')
    })

    it('包含转发与配图段落，段间各一条分隔线', () => {
        const markdown = buildWeiboNoteMarkdown(
            createPost({
                retweeted: {
                    id: '5200000000000001',
                    authorName: '原作者',
                    text: '原微博正文',
                    images: [],
                    imageIds: [],
                    isTruncated: false,
                },
                images: ['https://img.example.com/1.jpg'],
            }),
        )
        expect(markdown).toContain('## 转发内容')
        expect(markdown).toContain('原微博正文')
        expect(markdown).toContain('## 微博配图')
        expect(markdown).toContain('![测试作者 的配图](https://img.example.com/1.jpg)')
        const separators = markdown.split('\n').filter((line) => line === '---')
        expect(separators).toHaveLength(2)
    })

    it('配图本地化后用 @zhai 存储根口径引用，未搬运的保留远程直链', () => {
        const markdown = buildWeiboNoteMarkdown(
            createPost({ images: ['https://img.example.com/1.jpg', 'https://img.example.com/2.jpg'] }),
            { localImages: ['uploads/202611/20261120153045K3M9QZ.jpg', null] },
        )
        expect(markdown).toContain('![测试作者 的配图](@zhai/uploads/202611/20261120153045K3M9QZ.jpg)')
        expect(markdown).toContain('![测试作者 的配图](https://img.example.com/2.jpg)')
    })

    it('未提供本地化结果时配图全部保留远程直链', () => {
        const markdown = buildWeiboNoteMarkdown(createPost({ images: ['https://img.example.com/1.jpg'] }))
        expect(markdown).toContain('![测试作者 的配图](https://img.example.com/1.jpg)')
        expect(markdown).not.toContain('@zhai/')
    })

    it('视频直接忽略：直链与视频段落都不出现', () => {
        const markdown = buildWeiboNoteMarkdown(createPost({ videoUrl: 'https://video.example.com/a.mp4' }))
        expect(markdown).not.toContain('https://video.example.com/a.mp4')
        expect(markdown).not.toContain('## 视频')
        expect(markdown).not.toContain('### 视频')
    })

    it('长文摘要带截断说明', () => {
        const markdown = buildWeiboNoteMarkdown(createPost({ isTruncated: true }))
        expect(markdown).toContain('> 注：正文可能被上游截断，完整内容请看原文链接')
    })

    it('作者缺失时回退为未知作者', () => {
        const markdown = buildWeiboNoteMarkdown(createPost({ author: { id: '1234567890', name: '' } }))
        expect(markdown).toContain('> 作者：未知作者')
    })
})

describe('buildWeiboNoteTitle', () => {
    it('文件名由昵称与正文前 18 字组成', () => {
        expect(buildWeiboNoteTitle(createPost())).toBe('微博-测试作者-这是一条测试微博')
    })

    it('正文超过 18 字时文件名只取前 18 字且不带省略号', () => {
        const title = buildWeiboNoteTitle(createPost({ text: '一二三四五六七八九十一二三四五六七八九十' }))
        expect(title).toBe('微博-测试作者-一二三四五六七八九十一二三四五六七八')
        expect(title).not.toContain('...')
    })

    it('正文为空时文件名用「微博内容」兜底', () => {
        expect(buildWeiboNoteTitle(createPost({ text: '' }))).toBe('微博-测试作者-微博内容')
    })

    it('多行正文在文件名里折成单行', () => {
        expect(buildWeiboNoteTitle(createPost({ text: '第一行\n第二行' }))).toBe('微博-测试作者-第一行 第二行')
    })
})

describe('buildWeiboChatText', () => {
    it('给出作者、原文链接与正文', () => {
        const text = buildWeiboChatText(createPost())
        expect(text).toContain('微博 @测试作者')
        expect(text).toContain('原文：https://weibo.com/1234567890/Pabc123')
        expect(text).toContain('这是一条测试微博')
    })

    it('不把媒体直链塞进上下文', () => {
        const text = buildWeiboChatText(
            createPost({ images: ['https://img.example.com/1.jpg'], videoUrl: 'https://video.example.com/a.mp4' }),
        )
        expect(text).not.toContain('https://img.example.com/1.jpg')
        expect(text).not.toContain('https://video.example.com/a.mp4')
    })
})
