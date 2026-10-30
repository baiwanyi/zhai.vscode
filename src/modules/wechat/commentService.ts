/**
 * 留言服务：按「群发消息 + 文章序号」读取、回复、加精与删除留言。
 * 复用约定：Token 走 accountToken，接口走 openapi，批次与文章序号来自 wechat_issues / wechat_articles；
 * 平台侧用 0 基 index，界面用 1 基 sortIndex，转换只在本文件的 requireTarget 里发生一次。
 * 关键约束：必须已群发并保存了 msg_data_id，否则留言无法定位——此时直接给出可执行提示，
 * 而不是返回空列表让用户以为没有留言；批次归属也要校验，避免用 A 账号的 Token 查 B 账号的文章；
 * 留言内容不做本地存储，始终以平台为准，操作后由界面重新拉取。
 */
import { WECHAT_COMMENT_PAGE_SIZE } from '@shared/types/wechat'
import type {
    WechatCommentListRequest,
    WechatCommentListResult,
    WechatCommentMarkRequest,
    WechatCommentRemoveRequest,
    WechatCommentReplyRequest,
    WechatCommentSummary,
} from '@shared/types/wechat'
import { requireWechatToken } from './accountToken'
import { findWechatIssue } from './db/issueRepository'
import { deleteWechatComment, fetchWechatComments, markWechatComment, replyWechatComment } from './openapi'
import type { WechatTokenAccessDeps } from './accountToken'
import type { WechatCommentTarget } from './openapi'

export class WechatCommentService {
    public constructor(private readonly deps: WechatTokenAccessDeps) {}

    /** 读取一页留言：total 为平台给出的总数，界面据此显示「还有多少未加载」 */
    public async list(request: WechatCommentListRequest): Promise<WechatCommentListResult> {
        const target = this.requireTarget(request)
        const { accessToken } = await requireWechatToken(this.deps, request.accountId)
        const begin = request.offset ?? 0
        const outcome = await fetchWechatComments(accessToken, target, begin, WECHAT_COMMENT_PAGE_SIZE)
        if (!outcome.ok) {
            throw new Error(outcome.message)
        }
        const comments: WechatCommentSummary[] = outcome.data.comments.map((row) => ({
            id: row.commentId,
            openid: row.openid,
            createdAt: new Date(row.createTime * 1000).toISOString(),
            content: row.content,
            isElected: row.isElected,
            ...(row.replyContent === undefined ? {} : { replyContent: row.replyContent }),
        }))
        return { comments, total: outcome.data.total }
    }

    /** 回复留言：内容已由协议层收窄，这里只做去空白 */
    public async reply(request: WechatCommentReplyRequest): Promise<{ replied: boolean }> {
        const target = this.requireTarget(request)
        const { accessToken } = await requireWechatToken(this.deps, request.accountId)
        const outcome = await replyWechatComment(accessToken, target, request.commentId, request.content.trim())
        if (!outcome.ok) {
            throw new Error(outcome.message)
        }
        return { replied: true }
    }

    /** 设为 / 取消精选 */
    public async mark(request: WechatCommentMarkRequest): Promise<{ elected: boolean }> {
        const target = this.requireTarget(request)
        const { accessToken } = await requireWechatToken(this.deps, request.accountId)
        const outcome = await markWechatComment(accessToken, target, request.commentId, request.elected)
        if (!outcome.ok) {
            throw new Error(outcome.message)
        }
        return { elected: request.elected }
    }

    /** 删除留言：不可撤销 */
    public async remove(request: WechatCommentRemoveRequest): Promise<{ removed: boolean }> {
        const target = this.requireTarget(request)
        const { accessToken } = await requireWechatToken(this.deps, request.accountId)
        const outcome = await deleteWechatComment(accessToken, target, request.commentId)
        if (!outcome.ok) {
            throw new Error(outcome.message)
        }
        return { removed: true }
    }

    /**
     * 解析批次归属与平台定位参数：校验批次存在、属于该账号、且已保存群发消息标识。
     * 关键约束：index 由 1 基转 0 基只在这里做，其余地方一律用界面的 sortIndex。
     */
    private requireTarget(request: { accountId: string; issueId: string; sortIndex: number }): WechatCommentTarget {
        const issue = findWechatIssue(this.deps.db, request.issueId)
        if (issue === null) {
            throw new Error('推送批次不存在，可能已被删除')
        }
        if (issue.account_id !== request.accountId) {
            throw new Error('该批次不属于当前公众号账号')
        }
        if (issue.msg_data_id === null || issue.msg_data_id.length === 0) {
            throw new Error(
                '该批次没有群发消息标识：留言按「群发消息 + 文章序号」定位，请先用当前版本重新群发一次以记录标识',
            )
        }
        return { msgDataId: issue.msg_data_id, index: request.sortIndex - 1 }
    }
}
