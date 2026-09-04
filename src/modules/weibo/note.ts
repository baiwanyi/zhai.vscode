/**
 * 微博 → 笔记模块（复用 notes.md「网页剪藏」统一 Markdown 模板）。
 * 本模块只负责把微博转为 Markdown 内容；实际落盘由笔记模块 createFromContent 完成。
 */

import { extractMedia, resolveTarget } from './media'
import type { WeiboDetail } from './types'

/** 笔记落盘入口——由集成层传入笔记模块 API 实现 */
export interface NoteInserter {
    createFromContent(input: {
        markdown: string
        notebook?: string
        tags?: string[]
    }): Promise<{ path: string }>
}

/** 组装微博笔记的 Frontmatter + 正文（与 notes.md 剪藏模板一致） */
export function buildWeiboNoteMarkdown(
    detail: WeiboDetail,
    opts: { includeMedia?: boolean } = {},
): string {
    const target = resolveTarget(detail)
    const author = target.user?.screen_name ?? '未知作者'
    const uid = target.user?.id ?? 'unknown'
    const mid = target.mblogid ?? target.id ?? 'unknown'
    const permalink = `https://weibo.com/${uid}/${mid}`
    const createdAt = target.created_at ?? new Date().toISOString()
    const text = (target.text ?? '').replace(/<[^>]+>/g, '').trim() // 去 HTML 标签
    const title = `${author} 的微博`
    const tags = ['微博', 'weibo']

    const frontmatter = [
        '---',
        `title: ${JSON.stringify(title)}`,
        `created: ${createdAt}`,
        `tags: [${tags.map((t) => JSON.stringify(t)).join(', ')}]`,
        `source: ${permalink}`,
        '---',
        '',
    ].join('\n')

    const body: string[] = []
    body.push(`> 作者：${author}`)
    body.push(`> 原文：[微博链接](${permalink})`)
    body.push('> 采集方式：微博浏览器 · 保存为笔记')
    body.push('')
    body.push(text || '(无正文)')
    body.push('')

    if (opts.includeMedia !== false) {
        const media = extractMedia(detail)
        if (media.length) {
            body.push('### 媒体')
            for (const m of media) {
                if (m.type === 'image') body.push(`![${author} 的配图](${m.url})`)
                else body.push(`[▶ 视频](${m.url})`)
            }
            body.push('')
        }
    }
    return frontmatter + body.join('\n')
}

/** 保存微博为笔记：转 Markdown → 调笔记模块 → 返回笔记路径 */
export async function saveWeiboToNote(
    detail: WeiboDetail,
    notes: NoteInserter,
): Promise<{ path: string }> {
    const markdown = buildWeiboNoteMarkdown(detail)
    return notes.createFromContent({ markdown, tags: ['微博', 'weibo'] })
}
