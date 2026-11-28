/**
 * 留言筛选与计数：在已加载条目上按「精选 / 待回复」过滤，并给出各维度的条数。
 * 复用约定：纯函数、无副作用，出入参均为 WechatCommentSummary 列表，筛选栏、空态与页头共用同一口径。
 * 关键约束：平台列表接口只提供分页、没有筛选参数，这里的统计一律是「已加载条目」，
 * 调用方必须在界面上标明该边界，不能把它当成全量数字展示。
 */
import type { WechatCommentSummary } from '@shared/types/wechat'
import type { CommentFilter } from '../types'

export interface CommentFilterCounts {
    all: number
    elected: number
    unreplied: number
}

/** 是否已回复：待回复以「没有 replyContent」为判据，与协议层「未回复时缺省而非空串」保持一致 */
export function hasCommentReply(comment: WechatCommentSummary | null): boolean {
    return comment !== null && comment.replyContent !== undefined
}

/** 按维度过滤：待回复复用 hasCommentReply，避免筛选判据在界面里另写一份 */
export function filterComments(comments: WechatCommentSummary[], filter: CommentFilter): WechatCommentSummary[] {
    if (filter === 'elected') {
        return comments.filter((comment) => comment.isElected)
    }
    if (filter === 'unreplied') {
        return comments.filter((comment) => !hasCommentReply(comment))
    }
    return comments
}

/** 统计已加载条目的各维度数量：筛选标签上的数字直接取这里 */
export function countComments(comments: WechatCommentSummary[]): CommentFilterCounts {
    return {
        all: comments.length,
        elected: comments.filter((comment) => comment.isElected).length,
        unreplied: comments.filter((comment) => !hasCommentReply(comment)).length,
    }
}
