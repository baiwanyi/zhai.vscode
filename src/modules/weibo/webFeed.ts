/**
 * 微博信息流取数：关注时间线（默认分组）、热门（频道推荐）与自定义分组的端点适配。
 * 复用约定：端点差异只体现在地址与固定参数上，分页循环、增量判断、去重与字段归一化
 * 全部交给 webTimeline 的 fetchFriendTimeline；HTTP、节流与错误分类交给 webClient。
 * 关键约束：list_id 必须是纯数字串，时间线缺省时先取 allGroups 的默认分组再拼地址；
 * 每个端点返回的 statuses 层级不一致，统一按 statuses 与 cards.mblog 两种形态提取；
 * max_id 只能来自上一页响应，不能自行构造，到底时上游缺字段即视为没有更多。
 */
import type {
    WeiboFeedRequest,
    WeiboFeedSource,
    WeiboGroupItem,
    WeiboGroupsResult,
    WeiboTimelineResult,
} from '@shared/types/weibo'
import { WEIBO_FEED_DEFAULT_COUNT, isWeiboTimelineId } from '@shared/types/weibo'
import { WEIBO_WEB_ORIGIN, WeiboWebError, clampTimelineCount, requestWeiboJson, toIdString } from './webClient'
import { fetchFriendTimeline } from './webTimeline'
import type { TimelinePage, TimelinePageQuery, WeiboJsonQuery, WeiboJsonResponse } from './webClient'

/** 各信息流端点：端点差异由此表集中，新增来源只需补一行 */
const FEED_PATHS: Readonly<Record<WeiboFeedSource, string>> = {
    timeline: '/ajax/feed/friendstimeline',
    hot: '/ajax/feed/hottimeline',
    group: '/ajax/feed/groupstimeline',
}

/** 分组列表端点：一次取回全部分组，前端按「默认分组 / 我的分组」分别消费 */
const GROUPS_PATH = '/ajax/feed/allGroups'

/** 热门频道 id：网页端「推荐」频道固定用它作 group_id 与 containerid */
const HOT_CONTAINER_ID = '102803'

/** 热门频道的来源标记：上游据此区分发现页的新鲜流 */
const HOT_EXTPARAM = 'discover|new_feed'

/** 时间线的刷新标志位：与网页端首屏一致 */
const FEED_REFRESH = 4

/** 热门频道的刷新标志位：上游按 0 处理，带 4 会重复下发首屏 */
const HOT_REFRESH = 0

/** 默认分组中承载「最新微博」的条目名：时间线的 list_id 取自它 */
const DEFAULT_TIMELINE_GROUP_TITLE = '最新微博'

/** 是否为普通对象：数组与 null 都排除在外 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 夹取单页条数：非法值回落到信息流默认值 */
function clampFeedCount(value: number | undefined): number {
    return clampTimelineCount(value ?? WEIBO_FEED_DEFAULT_COUNT)
}

/** 构造信息流地址：list_id、刷新标志与游标都按来源固定，游标为空时回落到 since_id=0 */
export function buildFeedUrl(options: {
    source: WeiboFeedSource
    listId: string
    sinceId: string | null
    maxId: string | null
    count: number
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
        url.searchParams.set('group_id', HOT_CONTAINER_ID)
        url.searchParams.set('containerid', HOT_CONTAINER_ID)
        url.searchParams.set('extparam', HOT_EXTPARAM)
        url.searchParams.set('refresh', String(HOT_REFRESH))
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

/** 读取一个分组分区：按标题精确匹配，标题缺失时回落到固定下标 */
function readGroupSection(sections: unknown[], title: string, fallbackIndex: number): WeiboGroupItem[] {
    let source: unknown[] | null = null
    for (const section of sections) {
        if (isRecord(section) && section.title === title && Array.isArray(section.group)) {
            source = section.group
            break
        }
    }
    if (source === null) {
        const fallback = sections[fallbackIndex]
        source = isRecord(fallback) && Array.isArray(fallback.group) ? fallback.group : []
    }
    const items: WeiboGroupItem[] = []
    for (const entry of source) {
        const item = normalizeGroupItem(entry)
        if (item !== null) {
            items.push(item)
        }
    }
    return items
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
    const url = new URL(GROUPS_PATH, WEIBO_WEB_ORIGIN).toString()
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
    return {
        defaultGroups,
        myGroups,
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
}

/** 解析列表 id：热门固定频道号，时间线缺省时先取默认分组，分组不允许缺省 */
async function resolveFeedListId(
    options: FetchFeedOptions,
    requestJson: (query: WeiboJsonQuery) => Promise<WeiboJsonResponse>,
): Promise<string> {
    if (options.source === 'hot') {
        return HOT_CONTAINER_ID
    }
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
 * 拉取一条信息流。
 * 分页循环复用关注时间线的实现：带 maxId 向后翻，带 sinceId 做增量（只取一页）。
 */
export async function fetchWeiboFeed(options: FetchFeedOptions): Promise<WeiboTimelineResult> {
    const requestJson = options.requestJson ?? requestWeiboJson
    const listId = await resolveFeedListId(options, requestJson)
    const requestPage = async (query: TimelinePageQuery): Promise<TimelinePage> => {
        const { record } = await requestJson({
            url: buildFeedUrl({
                source: options.source,
                listId,
                sinceId: query.sinceId ?? null,
                maxId: query.maxId ?? null,
                count: clampFeedCount(query.count ?? options.count),
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
