/**
 * 微博模块共享类型与常量。
 * 设计源：docs/modules/weibo.md
 */

export const WEIBO_API_V2 = 'https://api.weibo.com/2'
export const WEIBO_REFERER = 'https://weibo.com'

export type MediaType = 'image' | 'video'

export interface WeiboUserRef {
    id: string
    screen_name: string
}

/** 单条评论 */
export interface WeiboComment {
    id: string
    authorId: string
    authorName: string
    text: string
    createdAt: string
}

/** 评论列表分页结果 */
export interface CommentListResult {
    comments: WeiboComment[]
    hasMore: boolean
    nextCursor: string | null
}

/** 媒体项（图片 / 视频） */
export interface WeiboMediaItem {
    type: MediaType
    url: string
    seq: number
    quality?: 'normal' | 'large' | 'hd'
}

/**
 * 微博详情——官方 ajax 接口结构宽松，善用可选字段。
 * 兼容 pic_ids / mix_media_info / page_info / retweeted_status 多形态。
 */
export interface WeiboDetail {
    user?: WeiboUserRef
    created_at?: string
    mblogid?: string
    id?: string
    text?: string
    pic_ids?: string[]
    mix_media_info?: {
        items?: Array<{
            data?: { media_info?: { id?: string }; src?: string }
        }>
    }
    page_info?: {
        type?: string
        media_info?: { stream_url?: string; mp4_720p_mp4?: string }
    }
    retweeted_status?: WeiboDetail
}

/** 下载任务 */
export interface DownloadTask {
    url: string
    filename: string
    referer: string
    timeoutMs: number
}

/** 统一 diff 片段 */
export type DiffHunkType = 'context' | 'add' | 'remove'

export interface DiffHunk {
    type: DiffHunkType
    content: string
    lineNo?: number
}

/** 用户采纳决策 */
export type DiffDecision = 'accept' | 'reject'

/** AI 润色请求 */
export interface AIEditRequest {
    text: string
    instruction: string
    model: 'deepseek-chat' | 'deepseek-reasoner'
}

export interface AIEditResult {
    original: string
    edited: string
}
