/**
 * 评论读取 / 发表（官方 Open API）。
 * - 读：comments/show
 * - 写：comments/create（新评论）/ comments/reply（回复）
 * 写操作本地幂等去重（sha256），依赖调用方的 hash 存储。
 */

import { weiboFetch } from './client'
import type { CommentListResult, WeiboComment } from './types'

export async function fetchComments(params: {
    accessToken: string
    mid: string
    cursor?: string
    pageSize?: number
}): Promise<CommentListResult> {
    const data = await weiboFetch<{ comments?: Array<Record<string, unknown>> }>('comments/show.json', {
        accessToken: params.accessToken,
        query: {
            id: params.mid,
            count: String(params.pageSize ?? 20),
            ...(params.cursor ? { page: params.cursor } : {}),
        },
    })

    const comments = (data.comments ?? []).map(normalizeComment)
    return {
        comments,
        hasMore: comments.length >= (params.pageSize ?? 20),
        nextCursor: comments.length ? String(Number(params.cursor ?? '1') + 1) : null,
    }
}

export async function postComment(params: {
    accessToken: string
    mid: string
    content: string
    replyCommentId?: string
    existsHash: (hash: string) => boolean
    saveHash: (hash: string) => void
}): Promise<{ ok: boolean; comment?: WeiboComment; error?: string }> {
    const hash = await sha256(
        `${params.accessToken}:${params.mid}:${params.replyCommentId ?? 'comment'}:${params.content}`,
    )
    if (params.existsHash(hash)) {
        return { ok: false, error: '幂等拦截：该评论已提交' }
    }

    const endpoint = params.replyCommentId ? 'comments/reply' : 'comments/create'
    const body = new URLSearchParams({
        id: params.mid,
        comment: params.content,
        ...(params.replyCommentId ? { cid: params.replyCommentId } : {}),
    })

    try {
        const data = await weiboFetch<Record<string, unknown>>(`${endpoint}.json`, {
            method: 'POST',
            accessToken: params.accessToken,
            body,
        })
        params.saveHash(hash)
        return { ok: true, comment: normalizeComment(data) }
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
}

export function normalizeComment(raw: Record<string, unknown>): WeiboComment {
    const user = (raw.user ?? {}) as Record<string, unknown>
    return {
        id: String(raw.id ?? ''),
        authorId: String(user.id ?? ''),
        authorName: String(user.screen_name ?? ''),
        text: String(raw.text ?? ''),
        createdAt: String(raw.created_at ?? ''),
    }
}

export async function sha256(input: string): Promise<string> {
    const data = new TextEncoder().encode(input)
    const buf = await crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
}
