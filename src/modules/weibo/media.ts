/**
 * 媒体解析、命名与下载任务组装（官方 ajax/statuses/show 详情）。
 * 命名规范见 docs/modules/weibo.md 第 10 节：
 *   weibo-{uid}-{timestamp}-{postId}[-{author}]-{seq:02d}.{ext}
 */

import { WEIBO_REFERER } from './types'
import type { DownloadTask, WeiboDetail, WeiboMediaItem } from './types'

/** 取目标微博（优先转发原博） */
export function resolveTarget(detail: WeiboDetail): WeiboDetail {
    return detail.retweeted_status ?? detail
}

/** 从详情提取图片 / 视频（兼容 pic_ids / mix_media_info / page_info） */
export function extractMedia(detail: WeiboDetail): WeiboMediaItem[] {
    const target = resolveTarget(detail)
    const items: WeiboMediaItem[] = []
    let seq = 0

    const mixed = target.mix_media_info?.items
    if (mixed?.length) {
        for (const it of mixed) {
            const src = it.data?.src
            if (src) items.push({ type: 'image', url: src, seq: seq++ })
        }
    } else if (target.pic_ids?.length) {
        for (const id of target.pic_ids) {
            items.push({ type: 'image', url: `https://wx1.sinaimg.cn/large/${id}.jpg`, seq: seq++ })
        }
    }

    const video =
        target.page_info?.media_info?.stream_url ?? target.page_info?.media_info?.mp4_720p_mp4
    if (video) items.push({ type: 'video', url: video, seq: seq++, quality: 'hd' })

    return items
}

/** 微博时间格式化为 YYYYMMDD-HHmm（无法解析则 unknown） */
export function formatWeiboTimestamp(raw?: string): string {
    if (!raw) return 'unknown'
    const d = new Date(raw)
    if (isNaN(d.getTime())) return 'unknown'
    const p = (n: number) => n.toString().padStart(2, '0')
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

/** 清洗作者名中的非法文件名字符（限长 16） */
export function sanitizeAuthor(name?: string): string {
    return (name ?? 'unknown').replace(/[\\/:*?"<>|]/g, '_').slice(0, 16)
}

/** 生成统一文件名 */
export function generateMediaFilename(params: {
    uid: string
    timestamp: string
    postId: string
    seq: number
    ext: string
    author?: string
    readable?: boolean
}): string {
    const { uid, timestamp, postId, seq, ext, author, readable } = params
    const base = `weibo-${uid}-${timestamp}-${postId}`
    const core = readable && author ? `${base}-${sanitizeAuthor(author)}` : base
    return `${core}-${seq.toString().padStart(2, '0')}.${ext}`
}

/** 组装下载任务（含 Referer 头与超时） */
export async function buildDownloadTasks(detail: WeiboDetail, readable = false): Promise<DownloadTask[]> {
    const target = resolveTarget(detail)
    const timestamp = formatWeiboTimestamp(target.created_at)
    return extractMedia(detail).map((m) => ({
        url: m.url,
        filename: generateMediaFilename({
            uid: target.user?.id ?? 'unknown',
            timestamp,
            postId: target.mblogid ?? target.id ?? 'unknown',
            seq: m.seq,
            ext: m.type === 'video' ? 'mp4' : 'jpg',
            author: target.user?.screen_name,
            readable,
        }),
        referer: WEIBO_REFERER,
        timeoutMs: 30_000,
    }))
}
