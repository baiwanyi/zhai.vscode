/**
 * 微博协议·信息流域：时间线、热门、分组信息流、我的赞、他人主页、分组表、表情与热搜榜。
 * 复用约定：入参收窄统一走 shared/types/weibo 的守卫，取数函数经 deps 注入、缺省回落各 api 模块；
 * 分组与热搜 band 的缓存策略在此决定，缓存读写细节交给 RouteSupport。
 * 关键约束：我的赞与他人主页需要当前账号 uid，只能由宿主解析、不接受前端传入；
 * 只有 band 参与磁盘缓存，其余热搜标签共用一条缓存会串数据。
 */
import {
    isWeiboFeedRequest,
    isWeiboHotRankRequest,
    isWeiboLikesRequest,
    isWeiboTimelineRequest,
    isWeiboTopicsRequest,
    isWeiboUserBlogRequest,
} from '@shared/types/weibo'
import type {
    WeiboEmoticonsResult,
    WeiboGroupsResult,
    WeiboHotRankResult,
    WeiboLikesResult,
    WeiboTimelineRequest,
    WeiboTimelineResult,
    WeiboTopicsResult,
    WeiboUserBlogResult,
} from '@shared/types/weibo'
import { WEIBO_METHODS } from '@shared/types/weiboMethods'
import type { WeiboRouteDeps } from '../deps'
import type { RouteSupport } from '../support'
import { fetchWeiboEmoticons } from '../../api/emoticons'
import { fetchWeiboFeed, fetchWeiboGroups, rememberHotChannels } from '../../api/feed'
import { fetchWeiboHotRank } from '../../api/hotRank'
import { fetchWeiboLikes } from '../../api/likes'
import { fetchWeiboTopics } from '../../api/topics'
import { fetchWeiboUserBlog } from '../../api/userBlog'
import { fetchFriendTimeline } from '../../timeline/query'
import { WeiboWebError } from '../../transport/httpClient'

/** 信息流域处理器：只做校验、缓存决策与调用编排，不写请求细节 */
export class FeedHandlers {
    public constructor(
        private readonly deps: WeiboRouteDeps,
        private readonly support: RouteSupport,
    ) {}

    /** 读取时间线：无凭证直接给出可执行的引导，不发起请求；时间线不参与缓存 */
    public async loadTimeline(payload: unknown): Promise<WeiboTimelineResult> {
        const raw = payload ?? {}
        if (!isWeiboTimelineRequest(raw)) {
            throw new WeiboWebError(
                'invalid-payload',
                `${WEIBO_METHODS.timeline} 参数非法：游标须为数字串，条数与页数须为有限数字`,
            )
        }
        const cookie = await this.support.readCookie()
        const request: WeiboTimelineRequest = raw
        const fetchTimeline = this.deps.fetchTimeline ?? fetchFriendTimeline
        return fetchTimeline({ ...request, cookie })
    }

    /** 读取信息流：时间线 / 热门 / 分组共用一条通道，无凭证直接给出可执行的引导 */
    public async loadFeed(payload: unknown): Promise<WeiboTimelineResult> {
        const raw = payload ?? {}
        if (!isWeiboFeedRequest(raw)) {
            throw new WeiboWebError(
                'invalid-payload',
                `${WEIBO_METHODS.feed} 参数非法：source 须为 timeline/hot/group，分组须带合法 listId`,
            )
        }
        const cookie = await this.support.readCookie()
        const fetchFeed = this.deps.fetchFeed ?? fetchWeiboFeed
        return fetchFeed({ ...raw, cookie })
    }

    /**
     * 读取我的赞：uid 由宿主自行解析，前端只给页码。
     * 关键约束：点赞列表只有页码分页、没有 max_id 游标，翻页由前端递增 page；
     * 解析不到 uid 时明确报错，而不是拼一个空 uid 的地址去撞上游。
     */
    public async loadLikes(payload: unknown): Promise<WeiboLikesResult> {
        const raw = payload ?? {}
        if (!isWeiboLikesRequest(raw)) {
            throw new WeiboWebError('invalid-payload', `${WEIBO_METHODS.likes} 参数非法：page 须为有限数字`)
        }
        const cookie = await this.support.readCookie()
        const uid = await this.support.resolveProfileUid(cookie, () => this.loadGroups())
        if (uid === null) {
            throw new WeiboWebError('upstream', '无法确定当前账号：分组信息里没有 uid，请重新登录微博后重试')
        }
        const fetchLikes = this.deps.fetchLikes ?? fetchWeiboLikes
        return fetchLikes({ cookie, uid, page: raw.page })
    }

    /**
     * 读取他人主页：uid 或昵称定位用户，再按页码取该用户的微博列表。
     * 关键约束：只读，缺凭证直接给出可执行的引导；昵称由取数层经资料回包换成 uid，
     * 本层不做地址拼装，也不允许前端指定任意地址。
     */
    public async loadUserBlog(payload: unknown): Promise<WeiboUserBlogResult> {
        const raw = payload ?? {}
        if (!isWeiboUserBlogRequest(raw)) {
            throw new WeiboWebError(
                'invalid-payload',
                `${WEIBO_METHODS.userBlog} 参数非法：uid 须为数字串，或给出长度不超过 64 的昵称，page 可选`,
            )
        }
        const cookie = await this.support.readCookie()
        const fetchUserBlog = this.deps.fetchUserBlog ?? fetchWeiboUserBlog
        return fetchUserBlog({ cookie, uid: raw.uid, screenName: raw.screenName, page: raw.page })
    }

    /**
     * 读取分组：默认分组供时间线取 list_id，我的分组供分组页展示。
     * 关键约束：命中缓存不再回源——分组只在激活预热与换号后重建。
     */
    public async loadGroups(): Promise<WeiboGroupsResult> {
        const cookie = await this.support.readCookie()
        const accountKey = this.support.accountKey(cookie)
        const cached = await this.support.readCachedGroups(accountKey)
        if (cached !== null) {
            // 磁盘缓存命中时取数层没被调用，这里补一次频道表登记，
            // 否则热门频道每次取数都会因为内存缓存为空而回源一次 allGroups
            rememberHotChannels(cookie, cached.hotChannels)
            return cached
        }
        const fetchGroups = this.deps.fetchGroups ?? fetchWeiboGroups
        const result = await fetchGroups({ cookie })
        const now = this.deps.now ?? ((): Date => new Date())
        this.support.saveCache('groups', accountKey, result, now().toISOString())
        return result
    }

    /** 读取表情配置：激活预热后常驻缓存，打开表情面板零网络 */
    public async loadEmoticons(): Promise<WeiboEmoticonsResult> {
        const cookie = await this.support.readCookie()
        const accountKey = this.support.accountKey(cookie)
        const cached = await this.support.readCachedEmoticons(accountKey)
        if (cached !== null) {
            return cached
        }
        const fetchEmoticons = this.deps.fetchEmoticons ?? fetchWeiboEmoticons
        const result = await fetchEmoticons({ cookie })
        this.support.saveCache('emoticons', accountKey, result, result.fetchedAt)
        return result
    }

    /**
     * 搜索话题：q 为空时取当前账号的常用话题，有关键字时按关键字搜索。
     * 关键约束：话题随热搜变化，不参与磁盘缓存，每次打开面板或改关键字都回源。
     */
    public async loadTopics(payload: unknown): Promise<WeiboTopicsResult> {
        const raw = payload ?? {}
        if (!isWeiboTopicsRequest(raw)) {
            throw new WeiboWebError('invalid-payload', `${WEIBO_METHODS.topics} 参数非法：q 须为不超过 50 字的字符串`)
        }
        const cookie = await this.support.readCookie()
        const fetchTopics = this.deps.fetchTopics ?? fetchWeiboTopics
        return fetchTopics({ cookie, q: raw.q })
    }

    /**
     * 读取热搜榜：band（侧栏）默认命中缓存，其余标签按请求实时回源。
     * 关键约束：只有 band 参与磁盘缓存——各标签的榜单内容互不相同，共用一条缓存会串数据；
     * 热搜页的刷新按钮传 refresh 为真，此时 band 也跳过缓存。
     */
    public async loadHotRank(payload: unknown): Promise<WeiboHotRankResult> {
        const raw = payload ?? {}
        if (!isWeiboHotRankRequest(raw)) {
            throw new WeiboWebError(
                'invalid-payload',
                `${WEIBO_METHODS.hotRank} 参数非法：refresh 须为布尔，tab 须为已登记来源，cityCode 须为四位数字`,
            )
        }
        const cookie = await this.support.readCookie()
        const accountKey = this.support.accountKey(cookie)
        const tab = raw.tab ?? 'band'
        const isCacheable = tab === 'band'
        if (isCacheable && raw.refresh !== true) {
            const cached = await this.support.readCachedHotRank(accountKey)
            if (cached !== null) {
                return cached
            }
        }
        const fetchHotRank = this.deps.fetchHotRank ?? fetchWeiboHotRank
        const result = await fetchHotRank({ cookie, tab, cityCode: raw.cityCode })
        if (isCacheable) {
            this.support.saveCache('hotRank', accountKey, result, result.fetchedAt)
        }
        return result
    }
}
