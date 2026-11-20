/**
 * 微博信息流取数：关注时间线（默认分组）、热门（按频道表选 group_id）与自定义分组的端点适配。
 * 复用约定：端点差异只体现在地址与固定参数上，分页循环、增量判断、去重与字段归一化
 * 全部交给 webTimeline 的 fetchFriendTimeline；HTTP、节流与错误分类交给 webClient。
 * 关键约束：list_id 必须是纯数字串，时间线缺省时先取 allGroups 的默认分组再拼地址；
 * 热门频道的 containerid 与 refresh 取自 shared 的 WEIBO_HOT_CHANNELS，不能由 group_id 推导；
 * 每个端点返回的 statuses 层级不一致，统一按 statuses 与 cards.mblog 两种形态提取；
 * max_id 只能来自上一页响应，不能自行构造，到底时上游缺字段即视为没有更多。
 */
import type {
    WeiboFeedRequest,
    WeiboFeedSource,
    WeiboGroupItem,
    WeiboGroupsResult,
    WeiboHotChannel,
    WeiboTimelineResult,
} from '@shared/types/weibo'
import { WEIBO_FEED_DEFAULT_COUNT, isWeiboTimelineId } from '@shared/types/weibo'
import { WeiboWebError, clampTimelineCount, requestWeiboJson, toIdString } from './webClient'
import { fetchFriendTimeline } from './webTimeline'
import { WEIBO_AJAX_PATHS, WEIBO_WEB_ORIGIN } from './weiboEndpoints'
import type { TimelinePage, TimelinePageQuery, WeiboJsonQuery, WeiboJsonResponse } from './webClient'

/** 各信息流端点：只做来源到地址总表的映射，新增来源补一行即可 */
const FEED_PATHS: Readonly<Record<WeiboFeedSource, string>> = {
    timeline: WEIBO_AJAX_PATHS.timeline,
    hot: WEIBO_AJAX_PATHS.hot,
    group: WEIBO_AJAX_PATHS.group,
}

/** 热门频道的来源标记：上游据此区分发现页的新鲜流 */
const HOT_EXTPARAM = 'discover|new_feed'

/** 时间线的刷新标志位：与网页端首屏一致 */
const FEED_REFRESH = 4

/** 频道表完全不可用时的兜底 gid：推荐频道，gid 与 containerid 同值 */
const HOT_FALLBACK_GID = '102803'

/** 热门频道兜底：gid 与 containerid 同值，推荐频道就是这种形态 */
function toHotChannelFallback(gid: string): WeiboHotChannel {
    return { gid, title: '', containerId: gid }
}

/** 默认分组中承载「最新微博」的条目名：时间线的 list_id 取自它 */
const DEFAULT_TIMELINE_GROUP_TITLE = '最新微博'

/** 热门频道所在分区：「我的频道」是账号已勾选的，「频道推荐」是上游补充的，按此顺序合并 */
const HOT_CHANNEL_SECTION_TITLES = ['我的频道', '频道推荐'] as const

/** 是否为普通对象：数组与 null 都排除在外 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 夹取单页条数：非法值回落到信息流默认值 */
function clampFeedCount(value: number | undefined): number {
    return clampTimelineCount(value ?? WEIBO_FEED_DEFAULT_COUNT)
}

/**
 * 频道表缓存：键为凭证 —— 换账号后频道集合不同，旧缓存不能串给新账号。
 * 关键约束：只在内存里比较凭证，不落盘、不进日志；为空时由 fetchWeiboGroups 回填。
 */
let hotChannelCache: { cookie: string; channels: readonly WeiboHotChannel[] } | null = null

/**
 * 写入频道表缓存：allGroups 每次取回都刷新一次，频道增删随之生效。
 * 路由层从磁盘缓存命中分组结果时也要调一次，否则热门取数会再回源一次 allGroups。
 */
export function rememberHotChannels(cookie: string, channels: readonly WeiboHotChannel[]): void {
    hotChannelCache = { cookie, channels }
}

/** 读取频道表缓存：凭证不一致一律视为没有缓存 */
function readCachedHotChannels(cookie: string): readonly WeiboHotChannel[] | null {
    return hotChannelCache !== null && hotChannelCache.cookie === cookie ? hotChannelCache.channels : null
}

/** 构造信息流地址：list_id、刷新标志与游标都按来源固定，游标为空时回落到 since_id=0 */
export function buildFeedUrl(options: {
    source: WeiboFeedSource
    listId: string
    sinceId: string | null
    maxId: string | null
    count: number
    /** 热门频道：containerid 只能由 allGroups 给出，缺省时按 gid 与 containerid 同值兜底 */
    hotChannel?: WeiboHotChannel | null
}): string {
    const url = new URL(FEED_PATHS[options.source], WEIBO_WEB_ORIGIN)
    const maxId = options.maxId?.trim() ?? ''
    const sinceId = options.sinceId?.trim() ?? ''

    if (options.source === 'timeline') {
        url.searchParams.set('list_id', options.listId)
        // fid 与 list_id 同值：网页端部分分支按 fid 识别列表
        url.searchParams.set('fid', options.listId)
        url.searchParams.set('refresh', String(FEED_REFRESH))
    } else if (options.source === 'group') {
        url.searchParams.set('list_id', options.listId)
        url.searchParams.set('refresh', String(FEED_REFRESH))
        url.searchParams.set('fast_refresh', '1')
    } else {
        // 热门频道：group_id 与 containerid 都来自 allGroups，refresh 统一按首屏语义取 0
        const channel = options.hotChannel ?? toHotChannelFallback(options.listId)
        url.searchParams.set('group_id', channel.gid)
        url.searchParams.set('containerid', channel.containerId)
        url.searchParams.set('extparam', HOT_EXTPARAM)
        url.searchParams.set('refresh', '0')
    }

    // 翻页与增量互斥：带 max_id 时上游会忽略 since_id，这里直接不传，减少歧义
    if (maxId.length > 0) {
        url.searchParams.set('max_id', maxId)
    } else {
        url.searchParams.set('since_id', sinceId.length > 0 ? sinceId : '0')
    }
    url.searchParams.set('count', String(clampFeedCount(options.count)))
    return url.toString()
}

/** 读取响应里承载微博列表的容器：热门流把数据放在 data 下，时间线放在顶层 */
function pickStatusContainer(record: Record<string, unknown>): Record<string, unknown> {
    return isRecord(record.data) ? record.data : record
}

/** 从 card 里取 mblog：卡片流可能直接给 mblog，也可能嵌在 card_group 里 */
function pushCardPosts(posts: unknown[], card: unknown): void {
    if (!isRecord(card)) {
        return
    }
    if (isRecord(card.mblog)) {
        posts.push(card.mblog)
        return
    }
    if (Array.isArray(card.card_group)) {
        for (const item of card.card_group) {
            if (isRecord(item) && isRecord(item.mblog)) {
                posts.push(item.mblog)
            }
        }
    }
}

/**
 * 提取原始微博数组。
 * 时间线与分组通常给 statuses，热门频道可能给 cards；两种形态都收，缺 id 的条目交给归一化丢弃。
 */
export function pickFeedPosts(record: Record<string, unknown>): unknown[] {
    const container = pickStatusContainer(record)
    if (Array.isArray(container.statuses)) {
        return container.statuses
    }
    const cards = Array.isArray(container.cards) ? container.cards : []
    const posts: unknown[] = []
    for (const card of cards) {
        pushCardPosts(posts, card)
    }
    return posts
}

/**
 * 读取游标：顶层优先，缺失时回落 data 内层。
 * "0" 与缺失同义——上游用它表示没有更多，留着会把「加载更多」永久点亮。
 */
function pickCursor(record: Record<string, unknown>, key: 'since_id' | 'max_id'): string | null {
    const direct = toIdString(record[key]) ?? (isRecord(record.data) ? toIdString(record.data[key]) : null)
    return direct === '0' ? null : direct
}

/** 把一次响应收敛成分页结果：结构异常不抛错，交给归一化后的空列表与「已到底」表达 */
function readFeedPage(record: Record<string, unknown>): TimelinePage {
    return {
        statuses: pickFeedPosts(record),
        sinceId: pickCursor(record, 'since_id'),
        maxId: pickCursor(record, 'max_id'),
    }
}

/** 分组条目归一化：缺 gid 或标题的条目直接丢弃，不进入列表 */
function normalizeGroupItem(value: unknown): WeiboGroupItem | null {
    if (!isRecord(value)) {
        return null
    }
    const gid = toIdString(value.gid)
    const title = typeof value.title === 'string' ? value.title.trim() : ''
    if (gid === null || title.length === 0) {
        return null
    }
    return {
        gid,
        title,
        uid: toIdString(value.uid) ?? '',
        isCustom: value.sysgroup === 0,
    }
}

/** 读取一个分区的原始条目：按标题精确匹配，找不到时可回落到固定下标 */
function readSectionEntries(sections: unknown[], title: string, fallbackIndex?: number): unknown[] {
    for (const section of sections) {
        if (isRecord(section) && section.title === title && Array.isArray(section.group)) {
            return section.group
        }
    }
    if (fallbackIndex === undefined) {
        return []
    }
    const fallback = sections[fallbackIndex]
    return isRecord(fallback) && Array.isArray(fallback.group) ? fallback.group : []
}

/** 读取一个分组分区：标题缺失时回落到固定下标，与时间线的 list_id 取值口径一致 */
function readGroupSection(sections: unknown[], title: string, fallbackIndex: number): WeiboGroupItem[] {
    const items: WeiboGroupItem[] = []
    for (const entry of readSectionEntries(sections, title, fallbackIndex)) {
        const item = normalizeGroupItem(entry)
        if (item !== null) {
            items.push(item)
        }
    }
    return items
}

/** 热门频道归一化：缺 gid 或标题即不可展示；containerid 缺失时按 gid 兜底（推荐频道就是同值） */
function normalizeHotChannel(value: unknown): WeiboHotChannel | null {
    if (!isRecord(value)) {
        return null
    }
    const gid = toIdString(value.gid)
    const title = typeof value.title === 'string' ? value.title.trim() : ''
    if (gid === null || title.length === 0) {
        return null
    }
    const containerId = typeof value.containerid === 'string' ? value.containerid.trim() : ''
    return { gid, title, containerId: containerId.length > 0 ? containerId : gid }
}

/**
 * 读取热门频道：合并「我的频道」与「频道推荐」两个分区，按 gid 去重并保持上游顺序。
 * 关键约束：只在缺 gid 或标题时丢弃条目 —— 频道清单由上游决定，前端不筛选。
 */
function readHotChannels(sections: unknown[]): WeiboHotChannel[] {
    const channels: WeiboHotChannel[] = []
    const seen = new Set<string>()
    for (const title of HOT_CHANNEL_SECTION_TITLES) {
        for (const entry of readSectionEntries(sections, title)) {
            const channel = normalizeHotChannel(entry)
            if (channel === null || seen.has(channel.gid)) {
                continue
            }
            seen.add(channel.gid)
            channels.push(channel)
        }
    }
    return channels
}

/** 取第一个可用 uid：拼个人主页地址时使用，缺失为空串 */
function pickUid(items: WeiboGroupItem[]): string | null {
    for (const item of items) {
        if (item.uid.length > 0) {
            return item.uid
        }
    }
    return null
}

/** 选择时间线的 list_id：优先默认分组里的「最新微博」，回退分区首项 */
export function pickDefaultTimelineListId(defaultGroups: WeiboGroupItem[]): string | null {
    const preferred = defaultGroups.find((item) => item.title === DEFAULT_TIMELINE_GROUP_TITLE)
    if (preferred !== undefined) {
        return preferred.gid
    }
    return defaultGroups[0]?.gid ?? null
}

/** 分组取数入参：requestJson 由单测注入，生产走真实请求 */
export interface FetchGroupsOptions {
    cookie: string
    timeoutMs?: number
    minIntervalMs?: number
    requestJson?: (query: WeiboJsonQuery) => Promise<WeiboJsonResponse>
}

/** 读取全部分组：默认分组供时间线取 list_id，我的分组供分组页展示 */
export async function fetchWeiboGroups(options: FetchGroupsOptions): Promise<WeiboGroupsResult> {
    const requestJson = options.requestJson ?? requestWeiboJson
    const url = new URL(WEIBO_AJAX_PATHS.groups, WEIBO_WEB_ORIGIN).toString()
    const { record } = await requestJson({
        url,
        cookie: options.cookie,
        timeoutMs: options.timeoutMs,
        minIntervalMs: options.minIntervalMs,
    })
    const sections = record.groups
    if (!Array.isArray(sections)) {
        throw new WeiboWebError('invalid-payload', '微博返回结构异常：groups 不是数组')
    }
    const defaultGroups = readGroupSection(sections, '默认分组', 0)
    const myGroups = readGroupSection(sections, '我的分组', 1)
    // 频道表随分组结果一起刷新：之后的 weibo/feed 直接读缓存，不必再打一次 allGroups
    const hotChannels = readHotChannels(sections)
    rememberHotChannels(options.cookie, hotChannels)
    return {
        defaultGroups,
        myGroups,
        hotChannels,
        timelineListId: pickDefaultTimelineListId(defaultGroups),
        uid: pickUid(defaultGroups) ?? pickUid(myGroups),
    }
}

/** 信息流取数入参：在协议入参之上补齐凭证与可注入的请求实现 */
export interface FetchFeedOptions extends WeiboFeedRequest {
    cookie: string
    timeoutMs?: number
    minIntervalMs?: number
    requestJson?: (query: WeiboJsonQuery) => Promise<WeiboJsonResponse>
    now?: () => Date
    /** 频道表：路由层已有分组结果时直接传入，省掉一次 allGroups 请求；缺省走缓存或回源 */
    hotChannels?: readonly WeiboHotChannel[] | null
}

/** 解析列表 id：时间线缺省时先取默认分组，分组不允许缺省（热门由 resolveHotChannel 单独处理） */
async function resolveFeedListId(
    options: FetchFeedOptions,
    requestJson: (query: WeiboJsonQuery) => Promise<WeiboJsonResponse>,
): Promise<string> {
    if (isWeiboTimelineId(options.listId)) {
        return options.listId
    }
    if (options.source === 'group') {
        throw new WeiboWebError('invalid-payload', '分组信息流缺少合法的 list_id')
    }
    const groups = await fetchWeiboGroups({
        cookie: options.cookie,
        timeoutMs: options.timeoutMs,
        minIntervalMs: options.minIntervalMs,
        requestJson,
    })
    const listId = pickDefaultTimelineListId(groups.defaultGroups)
    if (listId === null) {
        throw new WeiboWebError('upstream', '默认分组为空：无法确定关注时间线的 list_id')
    }
    return listId
}

/**
 * 解析热门频道：优先读 allGroups 回填的缓存，缺失时补取一次 allGroups。
 * 关键约束：指定的 gid 查不到时回落到频道表首项，表为空才用 gid 与 containerid 同值的兜底，
 * 不让一个陌生 gid（例如频道被上游下线）把整页打成错误。
 */
async function resolveHotChannel(
    options: FetchFeedOptions,
    requestJson: (query: WeiboJsonQuery) => Promise<WeiboJsonResponse>,
): Promise<WeiboHotChannel> {
    let channels = options.hotChannels ?? readCachedHotChannels(options.cookie)
    if (channels === null) {
        const groups = await fetchWeiboGroups({
            cookie: options.cookie,
            timeoutMs: options.timeoutMs,
            minIntervalMs: options.minIntervalMs,
            requestJson,
        })
        channels = groups.hotChannels
    }
    const wanted = typeof options.listId === 'string' ? options.listId.trim() : ''
    if (wanted.length > 0) {
        const matched = channels.find((channel) => channel.gid === wanted)
        if (matched !== undefined) {
            return matched
        }
    }
    return channels[0] ?? toHotChannelFallback(wanted.length > 0 ? wanted : HOT_FALLBACK_GID)
}

/**
 * 拉取一条信息流。
 * 分页循环复用关注时间线的实现：带 maxId 向后翻，带 sinceId 做增量（只取一页）。
 */
export async function fetchWeiboFeed(options: FetchFeedOptions): Promise<WeiboTimelineResult> {
    const requestJson = options.requestJson ?? requestWeiboJson
    // 热门要先确定 containerid；其余来源走常规的 list_id 解析
    const hotChannel = options.source === 'hot' ? await resolveHotChannel(options, requestJson) : null
    const listId = hotChannel === null ? await resolveFeedListId(options, requestJson) : hotChannel.gid
    const requestPage = async (query: TimelinePageQuery): Promise<TimelinePage> => {
        const { record } = await requestJson({
            url: buildFeedUrl({
                source: options.source,
                listId,
                sinceId: query.sinceId ?? null,
                maxId: query.maxId ?? null,
                count: clampFeedCount(query.count ?? options.count),
                hotChannel,
            }),
            cookie: options.cookie,
            timeoutMs: options.timeoutMs,
            minIntervalMs: query.minIntervalMs ?? options.minIntervalMs,
        })
        return readFeedPage(record)
    }
    return fetchFriendTimeline({
        cookie: options.cookie,
        sinceId: options.sinceId,
        maxId: options.maxId,
        count: options.count,
        maxPages: options.maxPages,
        requestPage,
        now: options.now,
    })
}
