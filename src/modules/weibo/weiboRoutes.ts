/**
 * 微博协议路由：把信息流、我的赞、热搜标签、同城城市、凭证、评论读取与发布 / 回复 / 删除、转发读取与提交 / 删除、点赞、发表框话题、发布与外链分发到取数、配置与宿主能力。
 * 复用约定：入参收窄统一走 shared/types/weibo 的类型守卫，本层只做方法名到实现的映射；
 * 分组、表情与侧栏默认榜（band）先读 weibo.json 缓存，其余热搜标签实时回源，缓存异常只记日志、绝不影响回包；
 * Cookie 存取交给 WeiboCookieStore，取数交给 webTimeline / webFeed，宿主能力以回调注入便于单测。
 * 关键约束：方法名与 shared/types/messages 的 HostMethodName 一一对应，新增方法须两侧同时维护；
 * 未登记方法一律抛错；时间线与凭证错误统一带分类码，前端按码分发提示而不是解析文案；
 * 外链只放行 weibo.com 及其子域，防止被当作任意地址跳转的通道；
 * 保存笔记与添加到 AI 对话前都对主贴与转发体的长文做全文补全，取不到全文时保留摘要并标注截断；
 * 评论添加到 AI 对话不再取数：正文由前端载荷带出，路由只做收窄。
 */
import { logger } from '@modules/common/logger'
import type {
    WeiboBlockListState,
    WeiboChatContextResult,
    WeiboCityState,
    WeiboClearCredentialResult,
    WeiboCommentChatPayload,
    WeiboCommentCreateResult,
    WeiboCommentDestroyResult,
    WeiboCommentLikeResult,
    WeiboCommentRepliesResult,
    WeiboCommentsResult,
    WeiboCredentialState,
    WeiboDestroyStatusResult,
    WeiboEmoticonsResult,
    WeiboGroupsResult,
    WeiboHotRankResult,
    WeiboImageResult,
    WeiboLikeResult,
    WeiboLikesResult,
    WeiboLongTextResult,
    WeiboNoteSaveResult,
    WeiboPagePostPayload,
    WeiboProfile,
    WeiboProfileResult,
    WeiboPublishResult,
    WeiboRepostChatPayload,
    WeiboRepostCreateResult,
    WeiboRepostsResult,
    WeiboSaveCredentialResult,
    WeiboTimelineRequest,
    WeiboTimelineResult,
    WeiboTopicsResult,
    WeiboVideoResult,
} from '@shared/types/weibo'
import {
    WEIBO_COMMENT_MAX_LENGTH,
    WEIBO_DEFAULT_CITY_CODE,
    WEIBO_REPOST_MAX_LENGTH,
    isWeiboCityCode,
    isWeiboCommentCreateRequest,
    isWeiboCommentDestroyRequest,
    isWeiboCommentLikeRequest,
    isWeiboCommentRepliesRequest,
    isWeiboCommentsRequest,
    isWeiboDestroyStatusRequest,
    isWeiboFeedRequest,
    isWeiboHotRankRequest,
    isWeiboImageRequest,
    isWeiboLikeRequest,
    isWeiboLikesRequest,
    isWeiboLongTextRequest,
    isWeiboOpenPostRequest,
    isWeiboProfileRequest,
    isWeiboPublishRequest,
    isWeiboRepostCreateRequest,
    isWeiboRepostsRequest,
    isWeiboSaveBlockListRequest,
    isWeiboSaveCityRequest,
    isWeiboSaveCredentialRequest,
    isWeiboTimelineRequest,
    isWeiboTopicsRequest,
    isWeiboVideoRequest,
    readWeiboCityName,
    readWeiboCommentChatPayload,
    readWeiboPagePost,
    readWeiboRepostChatPayload,
} from '@shared/types/weibo'
import { normalizeWeiboBlockList } from '@shared/utils/weiboBlock'
import { WeiboWebError } from './webClient'
import { createPostComment, destroyPostComment, fetchCommentReplies, fetchPostComments } from './webComments'
import { isCookieUsable, normalizeCookieInput } from './webCredential'
import { fetchWeiboEmoticons } from './webEmoticons'
import { fetchWeiboFeed, fetchWeiboGroups, rememberHotChannels } from './webFeed'
import { fetchWeiboHotRank } from './webHotRank'
import { setCommentLike, setPostLike, setRepostLike } from './webInteraction'
import { fetchWeiboLikes } from './webLikes'
import { fetchLongText } from './webLongText'
import { fetchWeiboProfile } from './webProfile'
import { publishWeibo } from './webPublish'
import { createPostRepost, destroyPostStatus, fetchPostReposts } from './webReposts'
import { fetchFriendTimeline } from './webTimeline'
import { fetchWeiboTopics } from './webTopics'
import { toAccountKey } from './weiboCache'
import type {
    CreateCommentOptions,
    DestroyCommentOptions,
    FetchCommentsOptions,
    FetchRepliesOptions,
} from './webComments'
import type { WeiboCookieStore } from './webCredential'
import type { FetchEmoticonsOptions } from './webEmoticons'
import type { FetchFeedOptions, FetchGroupsOptions } from './webFeed'
import type { FetchHotRankOptions } from './webHotRank'
import type { SetCommentLikeOptions, SetLikeOptions, SetRepostLikeOptions } from './webInteraction'
import type { FetchLikesOptions } from './webLikes'
import type { FetchLongTextOptions } from './webLongText'
import type { FetchProfileOptions } from './webProfile'
import type { PublishWeiboOptions, WeiboUploadImage } from './webPublish'
import type { CreateRepostOptions, DestroyStatusOptions, FetchRepostsOptions } from './webReposts'
import type { FetchTimelineOptions } from './webTimeline'
import type { FetchTopicsOptions } from './webTopics'
import type { WeiboAvatarGateway } from './weiboAvatar'
import type { WeiboCache, WeiboCacheKey } from './weiboCache'

/**
 * 允许打开的外链主机：微博主站与其子域，外加新浪短链服务 t.cn。
 * 关键约束：正文链接按此名单收窄，t.cn 是微博外链的固定中转域（https），
 * 不在名单内的地址前端不会渲染成可点链接，这里也不放行。
 */
const ALLOWED_EXTERNAL_HOSTS = ['weibo.com', 'www.weibo.com', 'm.weibo.cn', 't.cn']

/** 路由依赖：取数、图片代理与打开外链都可替换，生产由面板注入真实实现 */
export interface WeiboRouteDeps {
    cookieStore: WeiboCookieStore
    /** 读取同城城市代码：缺省回落默认城市，非法值同样回落 */
    readCityCode?: () => string
    /** 写入同城城市代码：由面板落到 zhai.weibo.cityCode 配置 */
    writeCityCode?: (cityCode: string) => Promise<void>
    /** 读取屏蔽用户名名单：由面板落到 zhai.weibo.blockedUsers 配置 */
    readBlockedUsers?: () => string[]
    /** 读取屏蔽关键字名单：由面板落到 zhai.weibo.blockedKeywords 配置 */
    readBlockedKeywords?: () => string[]
    /** 写入屏蔽名单：两个名单一次落盘，避免半份名单生效 */
    writeBlockList?: (list: WeiboBlockListState) => Promise<void>
    /** 元数据缓存：分组 / 热搜 / 表情的复用入口，未注入时退化为每次都回源 */
    cache?: WeiboCache
    fetchTimeline?: (options: FetchTimelineOptions) => Promise<WeiboTimelineResult>
    /** 信息流读取：时间线 / 热门 / 分组共用，单测可替换 */
    fetchFeed?: (options: FetchFeedOptions) => Promise<WeiboTimelineResult>
    /** 分组列表读取：默认分组与我的分组一次取回 */
    fetchGroups?: (options: FetchGroupsOptions) => Promise<WeiboGroupsResult>
    /** 表情配置读取：发表框的表情面板使用 */
    fetchEmoticons?: (options: FetchEmoticonsOptions) => Promise<WeiboEmoticonsResult>
    /** 话题搜索读取：发表框的话题面板使用 */
    fetchTopics?: (options: FetchTopicsOptions) => Promise<WeiboTopicsResult>
    /** 发布微博：默认走「图床换 pid → update 提交」两步，单测可替换 */
    publishPost?: (options: PublishWeiboOptions) => Promise<WeiboPublishResult>
    /** 读取 uploads 下的图片字节：发布前先传图床；未注入时带图发布会报未就绪 */
    readUploadImage?: (path: string) => Promise<WeiboUploadImage>
    /** 热搜榜读取：右侧边栏使用 */
    fetchHotRank?: (options: FetchHotRankOptions) => Promise<WeiboHotRankResult>
    /** 账号信息读取：顶栏账号菜单使用，默认走网页版 profile/info */
    fetchProfile?: (options: FetchProfileOptions) => Promise<WeiboProfile>
    /** 头像网关：读本地 weibo_avatar.jpg / 下载落盘 / 清除；未注入时账号菜单没有头像 */
    avatar?: WeiboAvatarGateway
    /** 图片代理：把远程图片下成本地文件并返回 Webview 可加载的地址 */
    resolveImageUrl?: (imageUrl: string) => Promise<string | null>
    /** 视频中转：把 CDN 整段 mp4 地址换成本地可播地址（本地服务补 Referer 流式转发，不落盘） */
    resolveVideoUrl?: (videoUrl: string) => Promise<string | null>
    /** 点赞写入：默认走网页版 setLike / cancelLike，单测可替换 */
    setLike?: (options: SetLikeOptions) => Promise<WeiboLikeResult>
    /** 评论点赞写入：默认走网页版 updateLike / destroyLike，单测可替换 */
    setCommentLike?: (options: SetCommentLikeOptions) => Promise<WeiboCommentLikeResult>
    /** 转发点赞写入：默认走网页版 setLike / cancelLike（form + fp），单测可替换 */
    setRepostLike?: (options: SetRepostLikeOptions) => Promise<WeiboLikeResult>
    /** 我的赞读取：默认走网页版 likelist，单测可替换 */
    fetchLikes?: (options: FetchLikesOptions) => Promise<WeiboLikesResult>
    /** 评论读取：默认走网页版 buildComments，单测可替换 */
    fetchComments?: (options: FetchCommentsOptions) => Promise<WeiboCommentsResult>
    /** 评论发布与回复：默认走网页版 comments/create 与 comments/reply，单测可替换 */
    createComment?: (options: CreateCommentOptions) => Promise<WeiboCommentCreateResult>
    /** 评论删除：默认走网页版 statuses/destroyComment，单测可替换 */
    destroyComment?: (options: DestroyCommentOptions) => Promise<WeiboCommentDestroyResult>
    /** 子评论读取：默认走网页版 buildComments（is_mix=1 / fetch_level=1），单测可替换 */
    fetchCommentReplies?: (options: FetchRepliesOptions) => Promise<WeiboCommentRepliesResult>
    /** 转发列表读取：默认走网页版 repostTimeline，单测可替换 */
    fetchReposts?: (options: FetchRepostsOptions) => Promise<WeiboRepostsResult>
    /** 转发提交：默认走网页版 normal_repost，单测可替换 */
    createRepost?: (options: CreateRepostOptions) => Promise<WeiboRepostCreateResult>
    /** 删除微博 / 转发：默认走网页版 statuses/destroy，单测可替换 */
    destroyStatus?: (options: DestroyStatusOptions) => Promise<WeiboDestroyStatusResult>
    /** 长文读取：默认走网页版 longtext，单测可替换 */
    fetchLongText?: (options: FetchLongTextOptions) => Promise<WeiboLongTextResult>
    /** 卡片动作·保存为笔记：由面板注入笔记落盘能力，未注入时该方法报未就绪 */
    saveToNote?: (post: WeiboPagePostPayload) => Promise<WeiboNoteSaveResult>
    /** 卡片动作·添加到 AI 对话：由面板注入会话能力，未注入时该方法报未就绪 */
    addToChat?: (post: WeiboPagePostPayload) => Promise<WeiboChatContextResult>
    /** 评论动作·添加到 AI 对话：评论正文由载荷带出，与卡片共用同一会话能力 */
    commentAddToChat?: (payload: WeiboCommentChatPayload) => Promise<WeiboChatContextResult>
    /** 转发动作·添加到 AI 对话：附言由载荷带出，与卡片共用同一会话能力 */
    repostAddToChat?: (payload: WeiboRepostChatPayload) => Promise<WeiboChatContextResult>
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

/** 缓存读取：未注入或读取异常一律按未命中处理——缓存不可用不应连带取数失败 */
async function readQuietly<T>(label: string, load: () => Promise<T | null>): Promise<T | null> {
    try {
        return await load()
    } catch (error) {
        logger.warn(`微博缓存读取失败：${label}（${error instanceof Error ? error.message : String(error)}）`)
        return null
    }
}

/** 缓存写入：失败只影响下次是否命中，不改变本次回包，也不打扰用户 */
function writeQuietly(label: string, task: Promise<void>): void {
    void task.catch((error: unknown) => {
        logger.warn(`微博缓存写入失败：${label}（${error instanceof Error ? error.message : String(error)}）`)
    })
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
            case 'weibo/likes':
                return this.loadLikes(payload)
            case 'weibo/groups':
                return this.loadGroups()
            case 'weibo/emoticons':
                return this.loadEmoticons()
            case 'weibo/topics':
                return this.loadTopics(payload)
            case 'weibo/publish':
                return this.loadPublish(payload)
            case 'weibo/hotRank':
                return this.loadHotRank(payload)
            case 'weibo/profile':
                return this.loadProfile(payload)
            case 'weibo/city/status':
                return this.readCityState()
            case 'weibo/city/save':
                return this.saveCity(payload)
            case 'weibo/blockList/status':
                return this.readBlockListState()
            case 'weibo/blockList/save':
                return this.saveBlockList(payload)
            case 'weibo/comments':
                return this.loadComments(payload)
            case 'weibo/comment/addToChat':
                return this.commentAddToChat(payload)
            case 'weibo/comment/create':
                return this.createComment(payload)
            case 'weibo/comment/destroy':
                return this.destroyComment(payload)
            case 'weibo/comment/like':
                return this.likeComment(payload)
            case 'weibo/comment/replies':
                return this.loadCommentReplies(payload)
            case 'weibo/reposts':
                return this.loadReposts(payload)
            case 'weibo/repost':
                return this.createRepost(payload)
            case 'weibo/repost/addToChat':
                return this.repostAddToChat(payload)
            case 'weibo/repost/like':
                return this.likeRepost(payload)
            case 'weibo/destroy':
                return this.destroyStatus(payload)
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
            case 'weibo/addToChat':
                return this.addToChat(payload)
            case 'weibo/saveToNote':
                return this.saveToNote(payload)
            case 'weibo/video':
                return this.loadVideo(payload)
            case 'weibo/openPost':
                return this.openPost(payload)
            default:
                throw new Error(`未登记的微博协议方法：${method}`)
        }
    }

    /** 读取登录 Cookie：缺失时抛带分类码的错误，避免每个方法各写一遍同样的判断 */
    private async readCookie(): Promise<string> {
        const cookie = await this.deps.cookieStore.read()
        if (!isCookieUsable(cookie)) {
            throw new WeiboWebError('no-credential', '尚未配置微博 Cookie：请先登录 weibo.com 并粘贴请求头中的 Cookie')
        }
        return cookie
    }

    /** 读分组缓存：命中即返回归一化后的回包，未命中返回 null 由调用方回源 */
    private async readCachedGroups(accountKey: string): Promise<WeiboGroupsResult | null> {
        const cache = this.deps.cache
        if (cache === undefined) {
            return null
        }
        const entry = await readQuietly('groups', async () => cache.readGroups(accountKey))
        return entry === null ? null : entry.data
    }

    /** 读热搜缓存：账号不符或过期都按未命中处理 */
    private async readCachedHotRank(accountKey: string): Promise<WeiboHotRankResult | null> {
        const cache = this.deps.cache
        if (cache === undefined) {
            return null
        }
        const entry = await readQuietly('hotRank', async () => cache.readHotRank(accountKey))
        return entry === null ? null : entry.data
    }

    /** 读表情缓存：账号不符或过期都按未命中处理 */
    private async readCachedEmoticons(accountKey: string): Promise<WeiboEmoticonsResult | null> {
        const cache = this.deps.cache
        if (cache === undefined) {
            return null
        }
        const entry = await readQuietly('emoticons', async () => cache.readEmoticons(accountKey))
        return entry === null ? null : entry.data
    }

    /** 读账号信息缓存：账号不符或过期都按未命中处理 */
    private async readCachedProfile(accountKey: string): Promise<WeiboProfile | null> {
        const cache = this.deps.cache
        if (cache === undefined) {
            return null
        }
        const entry = await readQuietly('profile', async () => cache.readProfile(accountKey))
        return entry === null ? null : entry.data
    }

    /** 写缓存：不等待落盘，失败只记日志——缓存问题不应影响本次回包 */
    private saveCache(key: WeiboCacheKey, accountKey: string, data: unknown, fetchedAt: string): void {
        const cache = this.deps.cache
        if (cache === undefined) {
            return
        }
        writeQuietly(key, cache.write(key, accountKey, data, fetchedAt))
    }

    /** 读取时间线：无凭证直接给出可执行的引导，不发起请求；时间线不参与缓存 */
    private async loadTimeline(payload: unknown): Promise<WeiboTimelineResult> {
        const raw = payload ?? {}
        if (!isWeiboTimelineRequest(raw)) {
            throw new WeiboWebError(
                'invalid-payload',
                'weibo/timeline 参数非法：游标须为数字串，条数与页数须为有限数字',
            )
        }
        const cookie = await this.readCookie()
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
        const cookie = await this.readCookie()
        const fetchFeed = this.deps.fetchFeed ?? fetchWeiboFeed
        return fetchFeed({ ...raw, cookie })
    }

    /**
     * 读取我的赞：uid 由宿主自行解析，前端只给页码。
     * 关键约束：点赞列表只有页码分页、没有 max_id 游标，翻页由前端递增 page；
     * 解析不到 uid 时明确报错，而不是拼一个空 uid 的地址去撞上游。
     */
    private async loadLikes(payload: unknown): Promise<WeiboLikesResult> {
        const raw = payload ?? {}
        if (!isWeiboLikesRequest(raw)) {
            throw new WeiboWebError('invalid-payload', 'weibo/likes 参数非法：page 须为有限数字')
        }
        const cookie = await this.readCookie()
        const uid = await this.resolveProfileUid(cookie)
        if (uid === null) {
            throw new WeiboWebError('upstream', '无法确定当前账号：分组信息里没有 uid，请重新登录微博后重试')
        }
        const fetchLikes = this.deps.fetchLikes ?? fetchWeiboLikes
        return fetchLikes({ cookie, uid, page: raw.page })
    }

    /**
     * 读取分组：默认分组供时间线取 list_id，我的分组供分组页展示。
     * 关键约束：命中缓存不再回源——分组只在激活预热与换号后重建。
     */
    private async loadGroups(): Promise<WeiboGroupsResult> {
        const cookie = await this.readCookie()
        const accountKey = toAccountKey(cookie)
        const cached = await this.readCachedGroups(accountKey)
        if (cached !== null) {
            // 磁盘缓存命中时取数层没被调用，这里补一次频道表登记，
            // 否则热门频道每次取数都会因为内存缓存为空而回源一次 allGroups
            rememberHotChannels(cookie, cached.hotChannels)
            return cached
        }
        const fetchGroups = this.deps.fetchGroups ?? fetchWeiboGroups
        const result = await fetchGroups({ cookie })
        const now = this.deps.now ?? ((): Date => new Date())
        this.saveCache('groups', accountKey, result, now().toISOString())
        return result
    }

    /** 读取表情配置：激活预热后常驻缓存，打开表情面板零网络 */
    private async loadEmoticons(): Promise<WeiboEmoticonsResult> {
        const cookie = await this.readCookie()
        const accountKey = toAccountKey(cookie)
        const cached = await this.readCachedEmoticons(accountKey)
        if (cached !== null) {
            return cached
        }
        const fetchEmoticons = this.deps.fetchEmoticons ?? fetchWeiboEmoticons
        const result = await fetchEmoticons({ cookie })
        this.saveCache('emoticons', accountKey, result, result.fetchedAt)
        return result
    }

    /**
     * 搜索话题：q 为空时取当前账号的常用话题，有关键字时按关键字搜索。
     * 关键约束：话题随热搜变化，不参与磁盘缓存，每次打开面板或改关键字都回源。
     */
    private async loadTopics(payload: unknown): Promise<WeiboTopicsResult> {
        const raw = payload ?? {}
        if (!isWeiboTopicsRequest(raw)) {
            throw new WeiboWebError('invalid-payload', 'weibo/topics 参数非法：q 须为不超过 50 字的字符串')
        }
        const cookie = await this.readCookie()
        const fetchTopics = this.deps.fetchTopics ?? fetchWeiboTopics
        return fetchTopics({ cookie, q: raw.q })
    }

    /**
     * 发布微博：收窄入参 → 读 uploads 图片字节 → 传图床换 pid → 提交正文与 pid。
     * 关键约束：正文与图片至少一项；图片逐张读取，任一缺失即整条放弃，绝不带半套图片发布；
     * 图床不需要账号 uid 与昵称（Cookie 已带登录态）；写操作不重试，失败文案直接回给前端，避免重复发博。
     */
    private async loadPublish(payload: unknown): Promise<WeiboPublishResult> {
        if (!isWeiboPublishRequest(payload)) {
            throw new WeiboWebError(
                'invalid-payload',
                'weibo/publish 参数非法：正文不超过 2000 字，图片须为 uploads 下最多 9 个文件路径，且正文与图片至少一项',
            )
        }
        const cookie = await this.readCookie()
        const readImage = this.deps.readUploadImage
        const images: WeiboUploadImage[] = []
        for (const path of payload.images ?? []) {
            if (readImage === undefined) {
                throw new WeiboWebError('upstream', '当前宿主未装配上传目录，无法读取发布图片')
            }
            try {
                images.push(await readImage(path))
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error)
                throw new WeiboWebError('invalid-payload', `读取发布图片失败：${reason}`)
            }
        }
        const publish = this.deps.publishPost ?? publishWeibo
        return publish({ cookie, content: payload.content, images })
    }

    /**
     * 读取热搜榜：band（侧栏）默认命中缓存，其余标签按请求实时回源。
     * 关键约束：只有 band 参与磁盘缓存——各标签的榜单内容互不相同，共用一条缓存会串数据；
     * 热搜页的刷新按钮传 refresh 为真，此时 band 也跳过缓存。
     */
    private async loadHotRank(payload: unknown): Promise<WeiboHotRankResult> {
        const raw = payload ?? {}
        if (!isWeiboHotRankRequest(raw)) {
            throw new WeiboWebError(
                'invalid-payload',
                'weibo/hotRank 参数非法：refresh 须为布尔，tab 须为已登记来源，cityCode 须为四位数字',
            )
        }
        const cookie = await this.readCookie()
        const accountKey = toAccountKey(cookie)
        const tab = raw.tab ?? 'band'
        const isCacheable = tab === 'band'
        if (isCacheable && raw.refresh !== true) {
            const cached = await this.readCachedHotRank(accountKey)
            if (cached !== null) {
                return cached
            }
        }
        const fetchHotRank = this.deps.fetchHotRank ?? fetchWeiboHotRank
        const result = await fetchHotRank({ cookie, tab, cityCode: raw.cityCode })
        if (isCacheable) {
            this.saveCache('hotRank', accountKey, result, result.fetchedAt)
        }
        return result
    }

    /** 同城城市：配置非法或未注入读写时回落默认城市，保证下拉总有可选值 */
    private readCityState(): WeiboCityState {
        const configured = this.deps.readCityCode?.() ?? ''
        const cityCode = isWeiboCityCode(configured) ? configured : WEIBO_DEFAULT_CITY_CODE
        return { cityCode, cityName: readWeiboCityName(cityCode) }
    }

    /** 保存同城城市：写入配置后回同一结构，前端直接替换本地状态 */
    private async saveCity(payload: unknown): Promise<WeiboCityState> {
        if (!isWeiboSaveCityRequest(payload)) {
            throw new WeiboWebError('invalid-payload', 'weibo/city/save 参数非法：cityCode 须为四位数字')
        }
        await this.deps.writeCityCode?.(payload.cityCode)
        return { cityCode: payload.cityCode, cityName: readWeiboCityName(payload.cityCode) }
    }

    /**
     * 读取屏蔽名单：配置缺省或未注入读取时回空名单，过滤是前端的事，宿主只负责存取。
     * 关键约束：读出的名单一律归一化（去空白、去重、截断超长项），
     * 让设置弹窗里的文本与真实生效的规则始终一致。
     */
    private readBlockListState(): WeiboBlockListState {
        return {
            blockedUsers: this.readBlockListItems(this.deps.readBlockedUsers),
            blockedKeywords: this.readBlockListItems(this.deps.readBlockedKeywords),
        }
    }

    /** 读取单个名单：设置文件被手改成非数组时按空名单处理，不让坏配置连带整个面板报错 */
    private readBlockListItems(read: (() => string[]) | undefined): string[] {
        const items = read?.()
        return normalizeWeiboBlockList(Array.isArray(items) ? items : [])
    }

    /** 保存屏蔽名单：两个名单整份替换，回包与状态同形，前端直接替换本地状态 */
    private async saveBlockList(payload: unknown): Promise<WeiboBlockListState> {
        if (!isWeiboSaveBlockListRequest(payload)) {
            throw new WeiboWebError('invalid-payload', 'weibo/blockList/save 参数非法：两个名单都须为字符串数组')
        }
        const list: WeiboBlockListState = {
            blockedUsers: normalizeWeiboBlockList(payload.blockedUsers),
            blockedKeywords: normalizeWeiboBlockList(payload.blockedKeywords),
        }
        await this.deps.writeBlockList?.(list)
        return list
    }

    /**
     * 读取账号信息与头像：用户信息落 weibo.json，头像落 {存储根}/weibo_avatar.jpg。
     * 关键约束：用户信息命中且本地头像可用时零网络；头像文件缺失但资料在时只重下头像、不重取资料；
     * uid 来自 weibo/groups（分组条目的 uid 即登录账号），取不到时明确报错而不是拼一个空地址。
     */
    private async loadProfile(payload: unknown): Promise<WeiboProfileResult> {
        const raw = payload ?? {}
        if (!isWeiboProfileRequest(raw)) {
            throw new WeiboWebError('invalid-payload', 'weibo/profile 参数非法：refresh 须为布尔')
        }
        const cookie = await this.readCookie()
        const accountKey = toAccountKey(cookie)
        if (raw.refresh !== true) {
            const cached = await this.readCachedProfile(accountKey)
            if (cached !== null) {
                const localAvatar = await this.readAvatar()
                // 本地文件在就完全零网络；不在则用缓存里的远程地址补一次下载
                return { profile: cached, avatarDataUrl: localAvatar ?? (await this.downloadAvatar(cached.avatarUrl)) }
            }
        }
        const uid = await this.resolveProfileUid(cookie)
        if (uid === null) {
            throw new WeiboWebError('upstream', '无法确定当前账号：分组信息里没有 uid，请重新登录微博后重试')
        }
        const fetchProfile = this.deps.fetchProfile ?? fetchWeiboProfile
        const profile = await fetchProfile({ cookie, uid })
        const now = this.deps.now ?? ((): Date => new Date())
        this.saveCache('profile', accountKey, profile, now().toISOString())
        return { profile, avatarDataUrl: await this.downloadAvatar(profile.avatarUrl) }
    }

    /** 取当前账号 uid：优先分组缓存，缺失时回源一次分组（loadGroups 内部会写缓存） */
    private async resolveProfileUid(cookie: string): Promise<string | null> {
        const cached = await this.readCachedGroups(toAccountKey(cookie))
        if (cached !== null && cached.uid !== null) {
            return cached.uid
        }
        const groups = await this.loadGroups()
        return groups.uid
    }

    /** 读本地头像：未注入网关时返回 null，账号菜单回落为昵称首字 */
    private async readAvatar(): Promise<string | null> {
        const avatar = this.deps.avatar
        if (avatar === undefined) {
            return null
        }
        try {
            return await avatar.read()
        } catch (error) {
            logger.warn(`微博头像读取失败：${error instanceof Error ? error.message : String(error)}`)
            return null
        }
    }

    /** 下载头像并落盘：失败只记日志，不阻断账号信息的回包 */
    private async downloadAvatar(avatarUrl: string): Promise<string | null> {
        const avatar = this.deps.avatar
        if (avatar === undefined) {
            return null
        }
        try {
            return await avatar.download(avatarUrl)
        } catch (error) {
            logger.warn(`微博头像下载失败：${error instanceof Error ? error.message : String(error)}`)
            return null
        }
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

    /** 清除凭证：Cookie、保存时刻、元数据缓存与本地头像一起删除 */
    private async clearCredential(): Promise<WeiboClearCredentialResult> {
        await this.deps.cookieStore.remove()
        await this.deps.cookieStore.removeSavedAt()
        // 缓存里留着旧账号的分组与榜单：一并删除，避免下次换号后命中不属于当前账号的数据
        await this.deps.cache?.clear()
        // 头像文件也要删：否则换号后顶栏会露出上一个账号的照片
        await this.deps.avatar?.clear()
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

    /**
     * 视频播放地址：把 CDN 地址换成本地中转地址（本地服务补 Referer 流式转发，不落盘）。
     * 关键约束：未注入中转服务时返回 null 而不是抛错——面板在禁用网络能力时也应能打开；
     * 前端拿到 null 会回退「打开原文」，不把一次播放失败升级成错误弹窗。
     */
    private async loadVideo(payload: unknown): Promise<WeiboVideoResult> {
        if (!isWeiboVideoRequest(payload)) {
            throw new WeiboWebError('invalid-payload', 'weibo/video 参数非法：url 必须为长度不超过 1024 的字符串')
        }
        const resolveVideoUrl = this.deps.resolveVideoUrl
        if (resolveVideoUrl === undefined) {
            return { url: null }
        }
        return { url: await resolveVideoUrl(payload.url) }
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
        const cookie = await this.readCookie()
        const fetchComments = this.deps.fetchComments ?? fetchPostComments
        return fetchComments({ ...raw, cookie })
    }

    /**
     * 展开更多回复：id 是一级评论 id，与评论列表共用一个端点，靠 is_mix / fetch_level 切到回复。
     * 关键约束：只读，缺凭证直接给出可执行的引导。
     */
    private async loadCommentReplies(payload: unknown): Promise<WeiboCommentRepliesResult> {
        const raw = payload ?? {}
        if (!isWeiboCommentRepliesRequest(raw)) {
            throw new WeiboWebError(
                'invalid-payload',
                'weibo/comment/replies 参数非法：id 须为数字评论 id，maxId 与 count 可选',
            )
        }
        const cookie = await this.readCookie()
        const loadReplies = this.deps.fetchCommentReplies ?? fetchCommentReplies
        return loadReplies({ ...raw, cookie })
    }

    /**
     * 转发列表：谁转发了这条微博，只有页码分页。
     * 关键约束：只读，缺凭证直接给出可执行的引导；翻页到底由「本页条数不足一页」判定。
     */
    private async loadReposts(payload: unknown): Promise<WeiboRepostsResult> {
        const raw = payload ?? {}
        if (!isWeiboRepostsRequest(raw)) {
            throw new WeiboWebError('invalid-payload', 'weibo/reposts 参数非法：id 须为数字微博 id，page 与 count 可选')
        }
        const cookie = await this.readCookie()
        const loadReposts = this.deps.fetchReposts ?? fetchPostReposts
        return loadReposts({ ...raw, cookie })
    }

    /**
     * 转发微博：附言可为空（纯转发），长度由协议层按 mode 收窄。
     * 关键约束：纯转发附言上限 500 字；转发并评论 / 评论并转发会生成评论，按评论上限 140 字收窄；
     * 写操作不重试，失败直接回错误码，由前端提示后用户手动重发。
     */
    private async createRepost(payload: unknown): Promise<WeiboRepostCreateResult> {
        if (!isWeiboRepostCreateRequest(payload)) {
            throw new WeiboWebError(
                'invalid-payload',
                `weibo/repost 参数非法：id 须为数字微博 id，附言可为空且纯转发不超过 ${String(WEIBO_REPOST_MAX_LENGTH)} 字，转发并评论时不超过 ${String(WEIBO_COMMENT_MAX_LENGTH)} 字`,
            )
        }
        const cookie = await this.readCookie()
        const repost = this.deps.createRepost ?? createPostRepost
        return repost({ cookie, id: payload.id, comment: payload.comment.trim(), mode: payload.mode })
    }

    /**
     * 删除微博 / 转发：只把 status id 交给上游，归属由上游判定（前端只给自己的内容放入口）。
     * 关键约束：写操作不重试，失败直接回错误码。
     */
    private async destroyStatus(payload: unknown): Promise<WeiboDestroyStatusResult> {
        if (!isWeiboDestroyStatusRequest(payload)) {
            throw new WeiboWebError('invalid-payload', 'weibo/destroy 参数非法：id 须为数字微博 id')
        }
        const cookie = await this.readCookie()
        const destroy = this.deps.destroyStatus ?? destroyPostStatus
        return destroy({ cookie, id: payload.id })
    }

    /**
     * 发布评论 / 回复评论：与时间线共用登录 Cookie，正文在协议层已去空白并校验长度。
     * 关键约束：带 replyToId 即走回复端点；写操作不重试，失败直接回错误码，由前端提示后用户手动重发。
     */
    private async createComment(payload: unknown): Promise<WeiboCommentCreateResult> {
        if (!isWeiboCommentCreateRequest(payload)) {
            throw new WeiboWebError(
                'invalid-payload',
                'weibo/comment/create 参数非法：id 须为数字微博 id，正文须为 1-140 字，replyToId 可选',
            )
        }
        const cookie = await this.readCookie()
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
    private async destroyComment(payload: unknown): Promise<WeiboCommentDestroyResult> {
        if (!isWeiboCommentDestroyRequest(payload)) {
            throw new WeiboWebError('invalid-payload', 'weibo/comment/destroy 参数非法：cid 须为数字评论 id')
        }
        const cookie = await this.readCookie()
        const removeComment = this.deps.destroyComment ?? destroyPostComment
        return removeComment({ cookie, cid: payload.cid })
    }

    /** 读取长文全文：id 用 mblogid（数字 id 也兼容），缺凭证直接给出可执行的引导 */
    private async loadLongText(payload: unknown): Promise<WeiboLongTextResult> {
        if (!isWeiboLongTextRequest(payload)) {
            throw new WeiboWebError('invalid-payload', 'weibo/longtext 参数非法：id 须为 mblogid 或数字 id')
        }
        const cookie = await this.readCookie()
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
        const cookie = await this.readCookie()
        const setLike = this.deps.setLike ?? setPostLike
        return setLike({ cookie, id: payload.id, liked: payload.liked })
    }

    /**
     * 评论点赞 / 取消点赞：与评论列表共用登录 Cookie，缺凭证直接给出可执行引导。
     * 关键约束：写操作不重试——失败即回包错误，由前端回滚乐观状态；评论 id 只接受数字串。
     */
    private async likeComment(payload: unknown): Promise<WeiboCommentLikeResult> {
        if (!isWeiboCommentLikeRequest(payload)) {
            throw new WeiboWebError(
                'invalid-payload',
                'weibo/comment/like 参数非法：cid 须为数字评论 id，liked 须为布尔',
            )
        }
        const cookie = await this.readCookie()
        const setLike = this.deps.setCommentLike ?? setCommentLike
        return setLike({ cookie, cid: payload.cid, liked: payload.liked })
    }

    /**
     * 转发点赞 / 取消点赞：与主贴点赞共用端点，参数由 webInteraction 按转发口径（form + fp）提交。
     * 关键约束：写操作不重试——失败即回包错误，由前端回滚乐观状态；id 只接受数字串。
     */
    private async likeRepost(payload: unknown): Promise<WeiboLikeResult> {
        if (!isWeiboLikeRequest(payload)) {
            throw new WeiboWebError('invalid-payload', 'weibo/repost/like 参数非法：id 须为数字微博 id，liked 须为布尔')
        }
        const cookie = await this.readCookie()
        const setLike = this.deps.setRepostLike ?? setRepostLike
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

    /**
     * 保存为笔记：载荷收窄 → 长文补全 → 交给笔记模块落盘并索引。
     * 关键约束：正文与链接都由 readWeiboPagePost 收窄，本层不拼路径也不改写内容；
     * 主贴或转发体被上游截断（长文）时先取全文，取不到才保留摘要。
     */
    private async saveToNote(payload: unknown): Promise<WeiboNoteSaveResult> {
        const post = readWeiboPagePost(payload)
        if (post === null) {
            throw new WeiboWebError('invalid-payload', 'weibo/saveToNote 参数非法：缺少合法正文、作者或微博链接')
        }
        const saveToNote = this.deps.saveToNote
        if (saveToNote === undefined) {
            throw new WeiboWebError('upstream', '当前宿主尚未装配笔记模块，无法保存为笔记')
        }
        return saveToNote(await this.expandLongText(post))
    }

    /**
     * 长文补全：主贴与转发体被截断时先取全文再存档。
     * 关键约束：非长文不发任何请求；取全文失败只记日志并保留摘要，不阻断保存（笔记里已有截断说明）。
     */
    private async expandLongText(post: WeiboPagePostPayload): Promise<WeiboPagePostPayload> {
        let next = post
        if (next.isTruncated) {
            const text = await this.readFullText(next.mblogid.length > 0 ? next.mblogid : next.id)
            if (text !== null) {
                next = { ...next, text, isTruncated: false }
            }
        }
        const retweeted = next.retweeted
        if (retweeted !== null && retweeted.isTruncated && retweeted.id.length > 0) {
            const text = await this.readFullText(retweeted.id)
            if (text !== null) {
                next = { ...next, retweeted: { ...retweeted, text, isTruncated: false } }
            }
        }
        return next
    }

    /** 取全文：复用长文接口的入参守卫与 Cookie，失败返回 null 由调用方保留摘要 */
    private async readFullText(id: string): Promise<string | null> {
        try {
            const result = await this.loadLongText({ id })
            return result.text.length > 0 ? result.text : null
        } catch (error) {
            logger.warn(
                `保存笔记前取全文失败，保留摘要：${id}（${error instanceof Error ? error.message : String(error)}）`,
            )
            return null
        }
    }

    /**
     * 添加到 AI 对话：载荷收窄 → 长文补全 → 交由 AI 层构造内联引用。
     * 关键约束：微博没有文档目录，会话作用域由 AI 层固定为 weibo 模块，路由不感知会话细节；
     * 与保存笔记同口径，主贴或转发体被截断时先取全文，失败只保留摘要，不阻断添加。
     */
    private async addToChat(payload: unknown): Promise<WeiboChatContextResult> {
        const post = readWeiboPagePost(payload)
        if (post === null) {
            throw new WeiboWebError('invalid-payload', 'weibo/addToChat 参数非法：缺少合法正文、作者或微博链接')
        }
        const addToChat = this.deps.addToChat
        if (addToChat === undefined) {
            throw new WeiboWebError('upstream', '当前宿主尚未装配 AI 对话，无法添加为上下文')
        }
        return addToChat(await this.expandLongText(post))
    }

    /**
     * 评论添加到 AI 对话：载荷收窄 → 交由 AI 层构造内联引用。
     * 关键约束：评论正文已在协议层收窄，本层不取数、不补全长文，也不接受任何评论链接；
     * 会话作用域同样由 AI 层固定为 weibo 模块，与主贴添加共用同一份上下文。
     */
    private async commentAddToChat(payload: unknown): Promise<WeiboChatContextResult> {
        const comment = readWeiboCommentChatPayload(payload)
        if (comment === null) {
            throw new WeiboWebError('invalid-payload', 'weibo/comment/addToChat 参数非法：缺少合法评论 id、作者或正文')
        }
        const commentAddToChat = this.deps.commentAddToChat
        if (commentAddToChat === undefined) {
            throw new WeiboWebError('upstream', '当前宿主尚未装配 AI 对话，无法添加为上下文')
        }
        return commentAddToChat(comment)
    }

    /**
     * 转发添加到 AI 对话：载荷收窄 → 交由 AI 层构造内联引用。
     * 关键约束：附言已在协议层收窄，本层不取数、不接受任何转发链接；
     * 会话作用域由 AI 层固定为 weibo 模块，与主贴、评论的添加共用同一份上下文。
     */
    private async repostAddToChat(payload: unknown): Promise<WeiboChatContextResult> {
        const repost = readWeiboRepostChatPayload(payload)
        if (repost === null) {
            throw new WeiboWebError('invalid-payload', 'weibo/repost/addToChat 参数非法：缺少合法转发 id、作者或附言')
        }
        const repostAddToChat = this.deps.repostAddToChat
        if (repostAddToChat === undefined) {
            throw new WeiboWebError('upstream', '当前宿主尚未装配 AI 对话，无法添加为上下文')
        }
        return repostAddToChat(repost)
    }
}
