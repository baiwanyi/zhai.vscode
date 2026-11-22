/**
 * 微博协议·互动域：评论读写与删除、转发列表与提交、点赞、关注与关注分组、备注名。
 * 复用约定：入参收窄统一走 shared/types/weibo 的守卫，写操作经 deps 注入、缺省回落各 api 模块；
 * 分组类写入会主动失效分组缓存，避免写后读拿到旧快照。
 * 关键约束：所有方法都要求登录凭证；写操作一律不重试，失败直接回错误码由前端回滚乐观状态；
 * 正文长度上限由协议层常量收窄，本层不再放宽。
 */
import {
    WEIBO_COMMENT_MAX_LENGTH,
    WEIBO_REPOST_MAX_LENGTH,
    isWeiboCommentCreateRequest,
    isWeiboCommentDestroyRequest,
    isWeiboCommentLikeRequest,
    isWeiboCommentRepliesRequest,
    isWeiboCommentsRequest,
    isWeiboDestroyStatusRequest,
    isWeiboFollowRequest,
    isWeiboGroupCreateRequest,
    isWeiboGroupSaveRequest,
    isWeiboLikeRequest,
    isWeiboRepostCreateRequest,
    isWeiboRepostsRequest,
    isWeiboUserGroupsRequest,
    isWeiboUserRemarkRequest,
} from '@shared/types/weibo'
import type {
    WeiboCommentCreateResult,
    WeiboCommentDestroyResult,
    WeiboCommentLikeResult,
    WeiboCommentRepliesResult,
    WeiboCommentsResult,
    WeiboDestroyStatusResult,
    WeiboFollowResult,
    WeiboGroupCreateResult,
    WeiboGroupSaveResult,
    WeiboLikeResult,
    WeiboRepostCreateResult,
    WeiboRepostsResult,
    WeiboUserGroupsResult,
    WeiboUserRemarkResult,
} from '@shared/types/weibo'
import { WEIBO_METHODS } from '@shared/types/weiboMethods'
import type { WeiboRouteDeps } from '../deps'
import type { RouteSupport } from '../support'
import { setAuthorFollow, setCommentLike, setPostLike, setRepostLike } from '../../api/write/interaction'
import { fetchCommentReplies, fetchPostComments } from '../../comments/read'
import { createPostComment, destroyPostComment } from '../../comments/write'
import { fetchUserGroups } from '../../groups/read'
import { createUserGroup, saveUserGroups, setUserRemark } from '../../groups/write'
import { fetchPostReposts } from '../../reposts/read'
import { createPostRepost, destroyPostStatus } from '../../reposts/write'
import { WeiboWebError } from '../../transport/httpClient'

/** 互动域处理器：读接口直通，写接口先失效相关缓存再回包 */
export class InteractionHandlers {
    public constructor(
        private readonly deps: WeiboRouteDeps,
        private readonly support: RouteSupport,
    ) {}

    /** 读取评论：与时间线共用登录 Cookie，缺凭证直接给出可执行的引导 */
    public async loadComments(payload: unknown): Promise<WeiboCommentsResult> {
        const raw = payload ?? {}
        if (!isWeiboCommentsRequest(raw)) {
            throw new WeiboWebError(
                'invalid-payload',
                `${WEIBO_METHODS.comments} 参数非法：id 须为数字微博 id，maxId 与 count 可选`,
            )
        }
        const cookie = await this.support.readCookie()
        const fetchComments = this.deps.fetchComments ?? fetchPostComments
        return fetchComments({ ...raw, cookie })
    }

    /**
     * 展开更多回复：id 是一级评论 id，与评论列表共用一个端点，靠 is_mix / fetch_level 切到回复。
     * 关键约束：只读，缺凭证直接给出可执行的引导。
     */
    public async loadCommentReplies(payload: unknown): Promise<WeiboCommentRepliesResult> {
        const raw = payload ?? {}
        if (!isWeiboCommentRepliesRequest(raw)) {
            throw new WeiboWebError(
                'invalid-payload',
                `${WEIBO_METHODS.commentReplies} 参数非法：id 须为数字评论 id，maxId 与 count 可选`,
            )
        }
        const cookie = await this.support.readCookie()
        const loadReplies = this.deps.fetchCommentReplies ?? fetchCommentReplies
        return loadReplies({ ...raw, cookie })
    }

    /**
     * 转发列表：谁转发了这条微博，只有页码分页。
     * 关键约束：只读，缺凭证直接给出可执行的引导；翻页到底由「本页条数不足一页」判定。
     */
    public async loadReposts(payload: unknown): Promise<WeiboRepostsResult> {
        const raw = payload ?? {}
        if (!isWeiboRepostsRequest(raw)) {
            throw new WeiboWebError(
                'invalid-payload',
                `${WEIBO_METHODS.reposts} 参数非法：id 须为数字微博 id，page 与 count 可选`,
            )
        }
        const cookie = await this.support.readCookie()
        const loadReposts = this.deps.fetchReposts ?? fetchPostReposts
        return loadReposts({ ...raw, cookie })
    }

    /**
     * 转发微博：附言可为空（纯转发），长度由协议层按 mode 收窄。
     * 关键约束：纯转发附言上限 500 字；转发并评论 / 评论并转发会生成评论，按评论上限 140 字收窄；
     * 写操作不重试，失败直接回错误码，由前端提示后用户手动重发。
     */
    public async createRepost(payload: unknown): Promise<WeiboRepostCreateResult> {
        if (!isWeiboRepostCreateRequest(payload)) {
            throw new WeiboWebError(
                'invalid-payload',
                `weibo/repost 参数非法：id 须为数字微博 id，附言可为空且纯转发不超过 ${String(WEIBO_REPOST_MAX_LENGTH)} 字，转发并评论时不超过 ${String(WEIBO_COMMENT_MAX_LENGTH)} 字`,
            )
        }
        const cookie = await this.support.readCookie()
        const repost = this.deps.createRepost ?? createPostRepost
        return repost({ cookie, id: payload.id, comment: payload.comment.trim(), mode: payload.mode })
    }

    /**
     * 删除微博 / 转发：只把 status id 交给上游，归属由上游判定（前端只给自己的内容放入口）。
     * 关键约束：写操作不重试，失败直接回错误码。
     */
    public async destroyStatus(payload: unknown): Promise<WeiboDestroyStatusResult> {
        if (!isWeiboDestroyStatusRequest(payload)) {
            throw new WeiboWebError('invalid-payload', `${WEIBO_METHODS.destroyStatus} 参数非法：id 须为数字微博 id`)
        }
        const cookie = await this.support.readCookie()
        const destroy = this.deps.destroyStatus ?? destroyPostStatus
        return destroy({ cookie, id: payload.id })
    }

    /**
     * 发布评论 / 回复评论：与时间线共用登录 Cookie，正文在协议层已去空白并校验长度。
     * 关键约束：带 replyToId 即走回复端点；写操作不重试，失败直接回错误码，由前端提示后用户手动重发。
     */
    public async createComment(payload: unknown): Promise<WeiboCommentCreateResult> {
        if (!isWeiboCommentCreateRequest(payload)) {
            throw new WeiboWebError(
                'invalid-payload',
                `${WEIBO_METHODS.commentCreate} 参数非法：id 须为数字微博 id，正文须为 1-140 字，replyToId 可选`,
            )
        }
        const cookie = await this.support.readCookie()
        const publishComment = this.deps.createComment ?? createPostComment
        return publishComment({
            cookie,
            id: payload.id,
            text: payload.text.trim(),
            ...(payload.replyToId === undefined ? {} : { replyToId: payload.replyToId }),
        })
    }

    /**
     * 删除评论：只把 cid 交给上游，归属由上游判定（前端只给自己的评论放入口）。
     * 关键约束：写操作不重试，失败直接回错误码。
     */
    public async destroyComment(payload: unknown): Promise<WeiboCommentDestroyResult> {
        if (!isWeiboCommentDestroyRequest(payload)) {
            throw new WeiboWebError('invalid-payload', `${WEIBO_METHODS.commentDestroy} 参数非法：cid 须为数字评论 id`)
        }
        const cookie = await this.support.readCookie()
        const removeComment = this.deps.destroyComment ?? destroyPostComment
        return removeComment({ cookie, cid: payload.cid })
    }

    /**
     * 点赞 / 取消点赞：与时间线共用登录 Cookie，缺凭证直接给出可执行的引导。
     * 关键约束：写操作不重试——失败即回包错误，由前端回滚乐观状态。
     */
    public async likePost(payload: unknown): Promise<WeiboLikeResult> {
        if (!isWeiboLikeRequest(payload)) {
            throw new WeiboWebError(
                'invalid-payload',
                `${WEIBO_METHODS.like} 参数非法：id 须为数字微博 id，liked 须为布尔`,
            )
        }
        const cookie = await this.support.readCookie()
        const setLike = this.deps.setLike ?? setPostLike
        return setLike({ cookie, id: payload.id, liked: payload.liked })
    }

    /**
     * 转发点赞 / 取消点赞：与主贴点赞共用端点，参数由 webInteraction 按转发口径（form + fp）提交。
     * 关键约束：写操作不重试——失败即回包错误，由前端回滚乐观状态；id 只接受数字串。
     */
    public async likeRepost(payload: unknown): Promise<WeiboLikeResult> {
        if (!isWeiboLikeRequest(payload)) {
            throw new WeiboWebError(
                'invalid-payload',
                `${WEIBO_METHODS.repostLike} 参数非法：id 须为数字微博 id，liked 须为布尔`,
            )
        }
        const cookie = await this.support.readCookie()
        const setLike = this.deps.setRepostLike ?? setRepostLike
        return setLike({ cookie, id: payload.id, liked: payload.liked })
    }

    /**
     * 关注 / 取消关注博主：与时间线共用登录 Cookie，缺凭证直接给出可执行的引导。
     * 关键约束：写操作不重试——失败即回包错误，由前端回滚乐观状态；uid 只接受数字串。
     */
    public async followAuthor(payload: unknown): Promise<WeiboFollowResult> {
        if (!isWeiboFollowRequest(payload)) {
            throw new WeiboWebError(
                'invalid-payload',
                `${WEIBO_METHODS.authorFollow} 参数非法：uid 须为数字博主 id，following 须为布尔`,
            )
        }
        const cookie = await this.support.readCookie()
        const setFollow = this.deps.setFollow ?? setAuthorFollow
        return setFollow({ cookie, uid: payload.uid, following: payload.following })
    }

    /**
     * 读取关注分组：目标用户所在分组 + 账号下全部分组，供设置分组弹窗一次渲染。
     * 关键约束：只读，缺凭证给出可执行引导；uid 只接受数字串。
     */
    public async loadUserGroups(payload: unknown): Promise<WeiboUserGroupsResult> {
        if (!isWeiboUserGroupsRequest(payload)) {
            throw new WeiboWebError('invalid-payload', `${WEIBO_METHODS.userGroups} 参数非法：uid 须为数字用户 id`)
        }
        const cookie = await this.support.readCookie()
        const readGroups = this.deps.fetchUserGroups ?? fetchUserGroups
        return readGroups({ cookie, uid: payload.uid })
    }

    /**
     * 新建关注分组：名称 1-8 字由协议层收窄，回包只回新分组本身。
     * 关键约束：写操作不重试，重复提交会在账号下生成同名分组。
     */
    public async createUserGroup(payload: unknown): Promise<WeiboGroupCreateResult> {
        if (!isWeiboGroupCreateRequest(payload)) {
            throw new WeiboWebError(
                'invalid-payload',
                `${WEIBO_METHODS.userGroupCreate} 参数非法：name 须为 1-8 字，isPublic 须为布尔`,
            )
        }
        const cookie = await this.support.readCookie()
        const create = this.deps.createUserGroup ?? createUserGroup
        const result = await create({ cookie, name: payload.name.trim(), isPublic: payload.isPublic })
        await this.support.invalidateGroups(cookie)
        return result
    }

    /**
     * 保存关注分组：把用户移入 listIds，originListIds 为请求前的分组。
     * 关键约束：空 listIds 表示移出自定义分组；写操作不重试。
     */
    public async saveUserGroups(payload: unknown): Promise<WeiboGroupSaveResult> {
        if (!isWeiboGroupSaveRequest(payload)) {
            throw new WeiboWebError(
                'invalid-payload',
                `${WEIBO_METHODS.userGroupSave} 参数非法：uid 与两组分组 id 都须为数字串数组`,
            )
        }
        const cookie = await this.support.readCookie()
        const save = this.deps.saveUserGroups ?? saveUserGroups
        const result = await save({
            cookie,
            uid: payload.uid,
            listIds: payload.listIds,
            originListIds: payload.originListIds,
        })
        await this.support.invalidateGroups(cookie)
        return result
    }

    /**
     * 设置关注备注：空串即清除，回包以上游返回的 remark 为准。
     * 关键约束：备注按字计不超过 15，写操作不重试。
     */
    public async setUserRemark(payload: unknown): Promise<WeiboUserRemarkResult> {
        if (!isWeiboUserRemarkRequest(payload)) {
            throw new WeiboWebError(
                'invalid-payload',
                `${WEIBO_METHODS.userRemark} 参数非法：uid 须为数字 id，remark 不超过 15 字`,
            )
        }
        const cookie = await this.support.readCookie()
        const saveRemark = this.deps.setUserRemark ?? setUserRemark
        const result = await saveRemark({ cookie, uid: payload.uid, remark: payload.remark })
        await this.support.invalidateGroups(cookie)
        return result
    }

    /**
     * 评论点赞 / 取消点赞：与评论列表共用登录 Cookie，缺凭证直接给出可执行引导。
     * 关键约束：写操作不重试——失败即回包错误，由前端回滚乐观状态；评论 id 只接受数字串。
     */
    public async likeComment(payload: unknown): Promise<WeiboCommentLikeResult> {
        if (!isWeiboCommentLikeRequest(payload)) {
            throw new WeiboWebError(
                'invalid-payload',
                `${WEIBO_METHODS.commentLike} 参数非法：cid 须为数字评论 id，liked 须为布尔`,
            )
        }
        const cookie = await this.support.readCookie()
        const setLike = this.deps.setCommentLike ?? setCommentLike
        return setLike({ cookie, cid: payload.cid, liked: payload.liked })
    }
}
