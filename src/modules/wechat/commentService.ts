/**
 * 留言服务：按「群发消息 + 文章序号」读取、回复、加精与删除留言，并提供原文链接查询。
 * 复用约定：Token 走 accountToken 并按失效码重取，接口走 openapi，批次与文章序号来自 wechat_issues；
 * 平台侧用 0 基 index，界面用 1 基 sortIndex，转换只在本文件的 requireTarget 里发生一次。
 * 关键约束：必须已群发并保存 msg_data_id，批次归属与文章范围都要校验，避免跨账号操作；
 * 平台没有「修改回复」接口，已回复留言的更新须先删后加，两步语义分别向用户交代；
 * 原文链接只查库不调平台且必须过域名白名单；留言内容不落库，始终以平台为准。
 */
import { WECHAT_COMMENT_PAGE_SIZE } from '@shared/types/wechat'
import type {
    WechatCommentListRequest,
    WechatCommentListResult,
    WechatCommentMarkRequest,
    WechatCommentRemoveRequest,
    WechatCommentReplyRequest,
    WechatCommentSummary,
    WechatCommentSwitchRequest,
    WechatCommentSwitchResult,
} from '@shared/types/wechat'
import { requireWechatToken } from './accountToken'
import { findWechatAccount } from './db/accountRepository'
import { findWechatIssue, updateWechatArticleAllowComment } from './db/issueRepository'
import {
    deleteWechatComment,
    deleteWechatCommentReply,
    fetchWechatComments,
    markWechatComment,
    replyWechatComment,
    switchWechatComment,
} from './openapi'
import type { WechatTokenAccessDeps } from './accountToken'
import type { WechatApiResult, WechatCommentTarget } from './openapi'

/** 原文来源白名单：只信任公众号图文页的 HTTPS 默认端口，避免明文或非常规端口被放行 */
const WECHAT_ARTICLE_ORIGIN = 'https://mp.weixin.qq.com'

/** Token 失效错误码：平台提前失效时清缓存重取一次，避免用户手动重试 */
const TOKEN_INVALID_CODES: ReadonlySet<number> = new Set([40001, 42001])

/** 已回复错误码：平台不支持直接修改回复，收到它才能走「先删后加」 */
const ALREADY_REPLIED_CODE = 88005

/** 校验原文链接：解析失败一律视为不可信，不抛错给上层 */
function isWechatArticleUrl(url: string): boolean {
    try {
        return new URL(url).origin === WECHAT_ARTICLE_ORIGIN
    } catch {
        return false
    }
}

export class WechatCommentService {
    public constructor(private readonly deps: WechatTokenAccessDeps) {}

    /** 读取一页留言：total 为平台给出的总数，界面据此显示「还有多少未加载」 */
    public async list(request: WechatCommentListRequest): Promise<WechatCommentListResult> {
        const target = this.requireTarget(request)
        const begin = request.offset ?? 0
        const outcome = await this.callWithTokenRetry(request.accountId, (token) =>
            fetchWechatComments(token, target, begin, WECHAT_COMMENT_PAGE_SIZE),
        )
        if (!outcome.ok) {
            throw new Error(outcome.message)
        }
        const comments: WechatCommentSummary[] = outcome.data.comments.map((row) => ({
            id: row.commentId,
            ...(row.openid === undefined ? {} : { openid: row.openid }),
            createdAt: new Date(row.createTime * 1000).toISOString(),
            content: row.content,
            isElected: row.isElected,
            ...(row.replyContent?.trim() ? { replyContent: row.replyContent } : {}),
        }))
        return { comments, total: outcome.data.total }
    }

    /**
     * 打开/关闭当前文章的评论。
     * 平台只提供写接口、不回读状态，成功后再把 enabled 写回本地文章，
     * 这样界面开关有稳定状态来源；写库失败不影响平台已生效的结果，仅提示刷新。
     */
    public async switchComment(request: WechatCommentSwitchRequest): Promise<WechatCommentSwitchResult> {
        const target = this.requireTarget(request)
        const outcome = await this.callWithTokenRetry(request.accountId, (token) =>
            switchWechatComment(token, target, request.enabled),
        )
        if (!outcome.ok) {
            throw new Error(outcome.message)
        }
        // 平台已生效，本地写库失败不能把整个操作报成失败，只能标记出来让界面提示刷新
        let isLocalSyncFailed = false
        try {
            updateWechatArticleAllowComment(this.deps.db, request.issueId, request.sortIndex, request.enabled)
        } catch {
            isLocalSyncFailed = true
        }
        return { enabled: request.enabled, localSyncFailed: isLocalSyncFailed }
    }

    /**
     * 回复留言：内容已由协议层收窄，这里只做去空白。
     * 首次回复直接走 reply/add；已回复时平台返回 88005，此时先删旧回复再加新回复。
     * 两步都有独立失败提示——删除成功但新增失败时必须告诉用户原回复已经没了，不能含糊成「操作失败」。
     */
    public async reply(request: WechatCommentReplyRequest): Promise<{ replied: boolean }> {
        const target = this.requireTarget(request)
        const content = request.content.trim()
        const addReply = (token: string): Promise<WechatApiResult<null>> =>
            replyWechatComment(token, target, request.commentId, content)

        let outcome = await this.callWithTokenRetry(request.accountId, addReply)
        if (!outcome.ok && outcome.errorCode === ALREADY_REPLIED_CODE) {
            const removal = await this.callWithTokenRetry(request.accountId, (token) =>
                deleteWechatCommentReply(token, target, request.commentId),
            )
            if (!removal.ok) {
                throw new Error(`旧回复删除失败，新回复未提交：${removal.message}`)
            }
            outcome = await this.callWithTokenRetry(request.accountId, addReply)
            if (!outcome.ok) {
                throw new Error(`旧回复已删除，但新回复提交失败：${outcome.message}。请重试或联系管理员恢复。`)
            }
        }
        if (!outcome.ok) {
            throw new Error(outcome.message)
        }
        return { replied: true }
    }

    /** 设为 / 取消精选 */
    public async mark(request: WechatCommentMarkRequest): Promise<{ elected: boolean }> {
        const target = this.requireTarget(request)
        const outcome = await this.callWithTokenRetry(request.accountId, (token) =>
            markWechatComment(token, target, request.commentId, request.elected),
        )
        if (!outcome.ok) {
            throw new Error(outcome.message)
        }
        return { elected: request.elected }
    }

    /** 删除留言：不可撤销 */
    public async remove(request: WechatCommentRemoveRequest): Promise<{ removed: boolean }> {
        const target = this.requireTarget(request)
        const outcome = await this.callWithTokenRetry(request.accountId, (token) =>
            deleteWechatComment(token, target, request.commentId),
        )
        if (!outcome.ok) {
            throw new Error(outcome.message)
        }
        return { removed: true }
    }

    /**
     * 读取留言所属文章的原文链接：只查库，不调平台接口。
     * 关键约束：链接来自平台回写，但落库后仍可能被改写，交给外部打开前必须再过一次域名白名单；
     * 没有链接时给出可执行提示（旧批次 / 未发布完成），而不是返回空串让调用方自行猜测。
     */
    public readArticleUrl(request: { accountId: string; issueId: string }): string {
        if (findWechatAccount(this.deps.db, request.accountId) === null) {
            throw new Error('公众号账号不存在，可能已被删除')
        }
        const issue = findWechatIssue(this.deps.db, request.issueId)
        if (issue === null) {
            throw new Error('推送批次不存在，可能已被删除')
        }
        if (issue.account_id !== request.accountId) {
            throw new Error('该批次不属于当前公众号账号')
        }
        const url = issue.article_url
        if (url === null || url.length === 0) {
            throw new Error('该批次还没有原文链接：群发成功后由平台回写，旧批次可能没有')
        }
        if (!isWechatArticleUrl(url)) {
            throw new Error('原文链接不是公众号图文地址，已拒绝打开')
        }
        return url
    }

    /**
     * 解析账号与批次归属：校验账号仍存在、批次属于该账号、已保存群发标识且文章序号在范围内。
     * 关键约束：账号存在性由本方法和 readArticleUrl 各自校验，因为后者不取 Token 也不走这里；
     * index 由 1 基转 0 基只在这里做，其余地方一律用界面的 sortIndex。
     */
    private requireTarget(request: { accountId: string; issueId: string; sortIndex: number }): WechatCommentTarget {
        if (findWechatAccount(this.deps.db, request.accountId) === null) {
            throw new Error('公众号账号不存在，可能已被删除')
        }
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
        if (!Number.isInteger(request.sortIndex) || request.sortIndex < 1 || request.sortIndex > issue.article_count) {
            throw new Error('文章序号不在当前批次的范围内')
        }
        return { msgDataId: issue.msg_data_id, index: request.sortIndex - 1 }
    }

    /**
     * 统一取 Token 并对平台明示的失效码重试一次。
     * 关键约束：重试前必须 invalidate，否则同一账号会继续拿到已失效的缓存 Token；
     * 密钥缺失、账号删除等非失效错误原样抛出，不做无意义重试。
     */
    private async callWithTokenRetry<T>(
        accountId: string,
        action: (accessToken: string) => Promise<WechatApiResult<T>>,
    ): Promise<WechatApiResult<T>> {
        let access = await requireWechatToken(this.deps, accountId)
        let outcome = await action(access.accessToken)
        if (!outcome.ok && TOKEN_INVALID_CODES.has(outcome.errorCode)) {
            this.deps.tokens.invalidate(accountId)
            access = await requireWechatToken(this.deps, accountId)
            outcome = await action(access.accessToken)
        }
        return outcome
    }
}
