/**
 * 微博协议路由：只做方法名到领域处理器的映射、写操作闸门与外链出口，业务细则在各 handler。
 * 复用约定：方法名统一取 @shared/types/weiboMethods（值只在该表出现一次），
 * 入参收窄、缓存策略、凭证副作用分别落在 protocol/handlers 与 protocol/support。
 * 关键约束：新增方法须在 switch 与常量表同时登记，漏了会在运行时抛「未登记的微博协议方法」；
 * 写操作先进互斥闸门（同方法 + 同载荷在飞行中只放行一次），防止双击与网络重发造成重复发博；
 * 外链只放行 weibo.com 及其子域，防止被当作任意地址跳转的通道。
 */
import { isWeiboOpenPostRequest } from '@shared/types/weibo'
import { WEIBO_METHODS } from '@shared/types/weiboMethods'
import { isAllowedExternalUrl } from './deps'
import { AccountHandlers } from './handlers/account'
import { ContentHandlers } from './handlers/content'
import { FeedHandlers } from './handlers/feed'
import { InteractionHandlers } from './handlers/interaction'
import { RouteSupport } from './support'
import { WriteGate, isWeiboWriteMethod } from './writeGate'
import type { WeiboRouteDeps } from './deps'
import { WeiboWebError } from '../transport/httpClient'

/** 微博协议路由：每个方法返回可直接回包的纯数据 */
export class WeiboRoutes {
    private readonly support: RouteSupport
    private readonly feed: FeedHandlers
    private readonly interaction: InteractionHandlers
    private readonly content: ContentHandlers
    private readonly account: AccountHandlers
    private readonly writeGate = new WriteGate()

    public constructor(private readonly deps: WeiboRouteDeps) {
        this.support = new RouteSupport(deps)
        this.feed = new FeedHandlers(deps, this.support)
        this.interaction = new InteractionHandlers(deps, this.support)
        this.content = new ContentHandlers(deps, this.support)
        this.account = new AccountHandlers(deps, this.support, () => this.feed.loadGroups())
    }

    /** 处理微博协议方法；写操作先进互斥闸门，未登记的方法抛错而不是静默返回空值 */
    public async handle(method: string, payload: unknown): Promise<unknown> {
        if (!isWeiboWriteMethod(method)) {
            return this.dispatch(method, payload)
        }
        return this.writeGate.run(method, payload, () => this.dispatch(method, payload))
    }

    /** 方法分发：只做方法名到领域处理器的映射 */
    private async dispatch(method: string, payload: unknown): Promise<unknown> {
        switch (method) {
            case WEIBO_METHODS.timeline:
                return this.feed.loadTimeline(payload)
            case WEIBO_METHODS.feed:
                return this.feed.loadFeed(payload)
            case WEIBO_METHODS.likes:
                return this.feed.loadLikes(payload)
            case WEIBO_METHODS.userBlog:
                return this.feed.loadUserBlog(payload)
            case WEIBO_METHODS.groups:
                return this.feed.loadGroups()
            case WEIBO_METHODS.emoticons:
                return this.feed.loadEmoticons()
            case WEIBO_METHODS.topics:
                return this.feed.loadTopics(payload)
            case WEIBO_METHODS.publish:
                return this.content.loadPublish(payload)
            case WEIBO_METHODS.hotRank:
                return this.feed.loadHotRank(payload)
            case WEIBO_METHODS.profile:
                return this.account.loadProfile(payload)
            case WEIBO_METHODS.cityStatus:
                return this.account.readCityState()
            case WEIBO_METHODS.citySave:
                return this.account.saveCity(payload)
            case WEIBO_METHODS.blockListStatus:
                return this.account.readBlockListState()
            case WEIBO_METHODS.blockListSave:
                return this.account.saveBlockList(payload)
            case WEIBO_METHODS.comments:
                return this.interaction.loadComments(payload)
            case WEIBO_METHODS.commentAddToChat:
                return this.content.commentAddToChat(payload)
            case WEIBO_METHODS.commentCreate:
                return this.interaction.createComment(payload)
            case WEIBO_METHODS.commentDestroy:
                return this.interaction.destroyComment(payload)
            case WEIBO_METHODS.commentLike:
                return this.interaction.likeComment(payload)
            case WEIBO_METHODS.commentReplies:
                return this.interaction.loadCommentReplies(payload)
            case WEIBO_METHODS.reposts:
                return this.interaction.loadReposts(payload)
            case WEIBO_METHODS.repost:
                return this.interaction.createRepost(payload)
            case WEIBO_METHODS.repostAddToChat:
                return this.content.repostAddToChat(payload)
            case WEIBO_METHODS.repostLike:
                return this.interaction.likeRepost(payload)
            case WEIBO_METHODS.destroyStatus:
                return this.interaction.destroyStatus(payload)
            case WEIBO_METHODS.longText:
                return this.content.loadLongText(payload)
            case WEIBO_METHODS.credentialStatus:
                return this.account.readCredentialState()
            case WEIBO_METHODS.credentialSave:
                return this.account.saveCredential(payload)
            case WEIBO_METHODS.credentialClear:
                return this.account.clearCredential()
            case WEIBO_METHODS.image:
                return this.content.loadImage(payload)
            case WEIBO_METHODS.like:
                return this.interaction.likePost(payload)
            case WEIBO_METHODS.authorFollow:
                return this.interaction.followAuthor(payload)
            case WEIBO_METHODS.userGroups:
                return this.interaction.loadUserGroups(payload)
            case WEIBO_METHODS.userGroupCreate:
                return this.interaction.createUserGroup(payload)
            case WEIBO_METHODS.userGroupSave:
                return this.interaction.saveUserGroups(payload)
            case WEIBO_METHODS.userRemark:
                return this.interaction.setUserRemark(payload)
            case WEIBO_METHODS.addToChat:
                return this.content.addToChat(payload)
            case WEIBO_METHODS.saveToNote:
                return this.content.saveToNote(payload)
            case WEIBO_METHODS.video:
                return this.content.loadVideo(payload)
            case WEIBO_METHODS.openPost:
                return this.openPost(payload)
            default:
                throw new Error(`未登记的微博协议方法：${method}`)
        }
    }

    /** 打开原微博：域名白名单校验通过才交给宿主 openExternal */
    private async openPost(payload: unknown): Promise<{ opened: boolean }> {
        if (!isWeiboOpenPostRequest(payload)) {
            throw new WeiboWebError(
                'invalid-payload',
                `${WEIBO_METHODS.openPost} 参数非法：url 必须为长度不超过 512 的字符串`,
            )
        }
        if (!isAllowedExternalUrl(payload.url)) {
            throw new WeiboWebError('invalid-payload', `${WEIBO_METHODS.openPost} 只允许打开 weibo.com 域名下的地址`)
        }
        const openExternal = this.deps.openExternal
        if (openExternal === undefined) {
            throw new WeiboWebError('upstream', '当前宿主不支持打开外部链接')
        }
        await openExternal(payload.url)
        return { opened: true }
    }
}

export type { WeiboRouteDeps }
