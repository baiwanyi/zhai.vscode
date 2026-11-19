/**
 * 微博协议路由：把信息流、凭证、评论、点赞与外链分发到取数、凭证与宿主能力。
 * 复用约定：入参收窄统一走 shared/types/weibo 的类型守卫，本层只做方法名到实现的映射；
 * Cookie 存取交给 WeiboCookieStore，取数交给 webTimeline / webFeed，宿主能力以回调注入便于单测。
 * 关键约束：方法名与 shared/types/messages 的 HostMethodName 一一对应，新增方法须两侧同时维护；
 * 未登记方法一律抛错；时间线与凭证错误统一带分类码，前端按码分发提示而不是解析文案；
 * 外链只放行 weibo.com 及其子域，防止被当作任意地址跳转的通道。
 */
import type {
    WeiboClearCredentialResult,
    WeiboCommentsResult,
    WeiboCredentialState,
    WeiboGroupsResult,
    WeiboImageResult,
    WeiboLikeResult,
    WeiboLongTextResult,
    WeiboSaveCredentialResult,
    WeiboTimelineRequest,
    WeiboTimelineResult,
} from '@shared/types/weibo'
import {
    isWeiboCommentsRequest,
    isWeiboFeedRequest,
    isWeiboImageRequest,
    isWeiboLikeRequest,
    isWeiboLongTextRequest,
    isWeiboOpenPostRequest,
    isWeiboSaveCredentialRequest,
    isWeiboTimelineRequest,
} from '@shared/types/weibo'
import { WeiboWebError } from './webClient'
import { fetchPostComments } from './webComments'
import { isCookieUsable, normalizeCookieInput } from './webCredential'
import { fetchWeiboFeed, fetchWeiboGroups } from './webFeed'
import { setPostLike } from './webInteraction'
import { fetchLongText } from './webLongText'
import { fetchFriendTimeline } from './webTimeline'
import type { FetchCommentsOptions } from './webComments'
import type { WeiboCookieStore } from './webCredential'
import type { FetchFeedOptions, FetchGroupsOptions } from './webFeed'
import type { SetLikeOptions } from './webInteraction'
import type { FetchLongTextOptions } from './webLongText'
import type { FetchTimelineOptions } from './webTimeline'

/** 允许打开的外链主机：仅微博主站与其子域 */
const ALLOWED_EXTERNAL_HOSTS = ['weibo.com', 'www.weibo.com', 'm.weibo.cn']

/** 路由依赖：取数、图片代理与打开外链都可替换，生产由面板注入真实实现 */
export interface WeiboRouteDeps {
    cookieStore: WeiboCookieStore
    fetchTimeline?: (options: FetchTimelineOptions) => Promise<WeiboTimelineResult>
    /** 信息流读取：时间线 / 热门 / 分组共用，单测可替换 */
    fetchFeed?: (options: FetchFeedOptions) => Promise<WeiboTimelineResult>
    /** 分组列表读取：默认分组与我的分组一次取回 */
    fetchGroups?: (options: FetchGroupsOptions) => Promise<WeiboGroupsResult>
    /** 图片代理：把远程图片下成本地文件并返回 Webview 可加载的地址 */
    resolveImageUrl?: (imageUrl: string) => Promise<string | null>
    /** 点赞写入：默认走网页版 setLike / cancelLike，单测可替换 */
    setLike?: (options: SetLikeOptions) => Promise<WeiboLikeResult>
    /** 评论读取：默认走网页版 buildComments，单测可替换 */
    fetchComments?: (options: FetchCommentsOptions) => Promise<WeiboCommentsResult>
    /** 长文读取：默认走网页版 longtext，单测可替换 */
    fetchLongText?: (options: FetchLongTextOptions) => Promise<WeiboLongTextResult>
    openExternal?: (url: string) => Promise<void>
    now?: () => Date
}

/** 判定外链主机是否在白名单内：末尾精确匹配，避免 sub.weibo.com.evil.com 绕过 */
function isAllowedExternalUrl(url: string): boolean {
    try {
        const parsed = new URL(url)
        if (parsed.protocol !== 'https:') {
            return false
        }
        return ALLOWED_EXTERNAL_HOSTS.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))
    } catch {
        return false
    }
}

/** 微博协议路由：每个方法返回可直接回包的纯数据 */
export class WeiboRoutes {
    public constructor(private readonly deps: WeiboRouteDeps) {}

    /** 处理微博协议方法；未登记的方法抛错而不是静默返回空值 */
    public async handle(method: string, payload: unknown): Promise<unknown> {
        switch (method) {
            case 'weibo/timeline':
                return this.loadTimeline(payload)
            case 'weibo/feed':
                return this.loadFeed(payload)
            case 'weibo/groups':
                return this.loadGroups()
            case 'weibo/comments':
                return this.loadComments(payload)
            case 'weibo/longtext':
                return this.loadLongText(payload)
            case 'weibo/credential/status':
                return this.readCredentialState()
            case 'weibo/credential/save':
                return this.saveCredential(payload)
            case 'weibo/credential/clear':
                return this.clearCredential()
            case 'weibo/image':
                return this.loadImage(payload)
            case 'weibo/like':
                return this.likePost(payload)
            case 'weibo/openPost':
                return this.openPost(payload)
            default:
                throw new Error(`未登记的微博协议方法：${method}`)
        }
    }

    /** 读取时间线：无凭证直接给出可执行的引导，不发起请求 */
    private async loadTimeline(payload: unknown): Promise<WeiboTimelineResult> {
        const raw = payload ?? {}
        if (!isWeiboTimelineRequest(raw)) {
            throw new WeiboWebError(
                'invalid-payload',
                'weibo/timeline 参数非法：游标须为数字串，条数与页数须为有限数字',
            )
        }
        const cookie = await this.deps.cookieStore.read()
        if (!isCookieUsable(cookie)) {
            throw new WeiboWebError('no-credential', '尚未配置微博 Cookie：请先登录 weibo.com 并粘贴请求头中的 Cookie')
        }
        const request: WeiboTimelineRequest = raw
        const fetchTimeline = this.deps.fetchTimeline ?? fetchFriendTimeline
        return fetchTimeline({ ...request, cookie })
    }

    /** 读取信息流：时间线 / 热门 / 分组共用一条通道，无凭证直接给出可执行的引导 */
    private async loadFeed(payload: unknown): Promise<WeiboTimelineResult> {
        const raw = payload ?? {}
        if (!isWeiboFeedRequest(raw)) {
            throw new WeiboWebError(
                'invalid-payload',
                'weibo/feed 参数非法：source 须为 timeline/hot/group，分组须带合法 listId',
            )
        }
        const cookie = await this.deps.cookieStore.read()
        if (!isCookieUsable(cookie)) {
            throw new WeiboWebError('no-credential', '尚未配置微博 Cookie：请先登录 weibo.com 并粘贴请求头中的 Cookie')
        }
        const fetchFeed = this.deps.fetchFeed ?? fetchWeiboFeed
        return fetchFeed({ ...raw, cookie })
    }

    /** 读取分组：默认分组供时间线取 list_id，我的分组供分组页展示 */
    private async loadGroups(): Promise<WeiboGroupsResult> {
        const cookie = await this.deps.cookieStore.read()
        if (!isCookieUsable(cookie)) {
            throw new WeiboWebError('no-credential', '尚未配置微博 Cookie：请先登录 weibo.com 并粘贴请求头中的 Cookie')
        }
        const fetchGroups = this.deps.fetchGroups ?? fetchWeiboGroups
        return fetchGroups({ cookie })
    }

    /** 凭证状态：只回配置标记与保存时间 */
    private async readCredentialState(): Promise<WeiboCredentialState> {
        const cookie = await this.deps.cookieStore.read()
        const savedAt = await this.deps.cookieStore.readSavedAt()
        return {
            isConfigured: isCookieUsable(cookie),
            savedAt: savedAt ?? null,
        }
    }

    /** 保存 Cookie：清洗后写入 SecretStorage，并记录保存时刻 */
    private async saveCredential(payload: unknown): Promise<WeiboSaveCredentialResult> {
        if (!isWeiboSaveCredentialRequest(payload)) {
            throw new WeiboWebError('invalid-payload', 'weibo/credential/save 参数非法：cookie 必须为非空字符串')
        }
        const cookie = normalizeCookieInput(payload.cookie)
        await this.deps.cookieStore.write(cookie)
        const now = this.deps.now ?? ((): Date => new Date())
        const savedAt = now().toISOString()
        await this.deps.cookieStore.writeSavedAt(savedAt)
        return { isConfigured: true, savedAt }
    }

    /** 清除凭证：Cookie 与保存时刻一起删除 */
    private async clearCredential(): Promise<WeiboClearCredentialResult> {
        await this.deps.cookieStore.remove()
        await this.deps.cookieStore.removeSavedAt()
        return { isConfigured: false }
    }

    /**
     * 图片代理：图床按 Referer 放行，Webview 直连必被拒，统一由宿主取回再签发本地地址。
     * 未注入代理时返回 null 而不是抛错——面板在没有缓存目录的宿主上仍应能打开。
     */
    private async loadImage(payload: unknown): Promise<WeiboImageResult> {
        if (!isWeiboImageRequest(payload)) {
            throw new WeiboWebError('invalid-payload', 'weibo/image 参数非法：url 必须为长度不超过 1024 的字符串')
        }
        const resolveImageUrl = this.deps.resolveImageUrl
        if (resolveImageUrl === undefined) {
            return { url: null }
        }
        return { url: await resolveImageUrl(payload.url) }
    }

    /** 读取评论：与时间线共用登录 Cookie，缺凭证直接给出可执行的引导 */
    private async loadComments(payload: unknown): Promise<WeiboCommentsResult> {
        const raw = payload ?? {}
        if (!isWeiboCommentsRequest(raw)) {
            throw new WeiboWebError(
                'invalid-payload',
                'weibo/comments 参数非法：id 须为数字微博 id，maxId 与 count 可选',
            )
        }
        const cookie = await this.deps.cookieStore.read()
        if (!isCookieUsable(cookie)) {
            throw new WeiboWebError('no-credential', '尚未配置微博 Cookie：请先登录 weibo.com 并粘贴请求头中的 Cookie')
        }
        const fetchComments = this.deps.fetchComments ?? fetchPostComments
        return fetchComments({ ...raw, cookie })
    }

    /** 读取长文全文：id 用 mblogid（数字 id 也兼容），缺凭证直接给出可执行的引导 */
    private async loadLongText(payload: unknown): Promise<WeiboLongTextResult> {
        if (!isWeiboLongTextRequest(payload)) {
            throw new WeiboWebError('invalid-payload', 'weibo/longtext 参数非法：id 须为 mblogid 或数字 id')
        }
        const cookie = await this.deps.cookieStore.read()
        if (!isCookieUsable(cookie)) {
            throw new WeiboWebError('no-credential', '尚未配置微博 Cookie：请先登录 weibo.com 并粘贴请求头中的 Cookie')
        }
        const load = this.deps.fetchLongText ?? fetchLongText
        return load({ cookie, id: payload.id })
    }

    /**
     * 点赞 / 取消点赞：与时间线共用登录 Cookie，缺凭证直接给出可执行的引导。
     * 关键约束：写操作不重试——失败即回包错误，由前端回滚乐观状态。
     */
    private async likePost(payload: unknown): Promise<WeiboLikeResult> {
        if (!isWeiboLikeRequest(payload)) {
            throw new WeiboWebError('invalid-payload', 'weibo/like 参数非法：id 须为数字微博 id，liked 须为布尔')
        }
        const cookie = await this.deps.cookieStore.read()
        if (!isCookieUsable(cookie)) {
            throw new WeiboWebError('no-credential', '尚未配置微博 Cookie：请先登录 weibo.com 并粘贴请求头中的 Cookie')
        }
        const setLike = this.deps.setLike ?? setPostLike
        return setLike({ cookie, id: payload.id, liked: payload.liked })
    }

    /** 打开原微博：域名白名单校验通过才交给宿主 openExternal */
    private async openPost(payload: unknown): Promise<{ opened: boolean }> {
        if (!isWeiboOpenPostRequest(payload)) {
            throw new WeiboWebError('invalid-payload', 'weibo/openPost 参数非法：url 必须为长度不超过 512 的字符串')
        }
        if (!isAllowedExternalUrl(payload.url)) {
            throw new WeiboWebError('invalid-payload', 'weibo/openPost 只允许打开 weibo.com 域名下的地址')
        }
        const openExternal = this.deps.openExternal
        if (openExternal === undefined) {
            throw new WeiboWebError('upstream', '当前宿主不支持打开外部链接')
        }
        await openExternal(payload.url)
        return { opened: true }
    }
}
