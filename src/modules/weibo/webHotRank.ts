/**
 * 微博热搜榜：把侧栏 bandUnified 的 realtime 列表收敛成可展示的榜单项。
 * 复用约定：请求走 webClient 的通用 JSON 通道（同一套请求头、节流与错误分类），
 * 图标地址统一过 webTimeline 的 normalizeWeiboImageUrl 收窄，徽标底色只接受合法颜色字面量。
 * 关键约束：上游可能把 realtime 放在 data 顶层，也可能嵌在 data.band_list[*] 里，两种都要兼容；
 * 名次优先取 realpos（网页端的真实排名），广告位、标注「商」「上新」的推广位与缺标题的条目直接丢弃但不打乱已有序号；
 * 图标字段在不同版本里叫 icon 或 icon_url，标记文案以 icon_desc 为主、label_name 兜底。
 */
import type { WeiboHotRankItem, WeiboHotRankResult } from '@shared/types/weibo'
import { WEIBO_WEB_ORIGIN, WeiboWebError, requestWeiboJson } from './webClient'
import { normalizeWeiboImageUrl } from './webTimeline'
import type { WeiboJsonQuery, WeiboJsonResponse } from './webClient'

/** 侧栏榜单端点：mine 表示当前账号的默认侧栏配置 */
const HOT_RANK_PATH = '/ajax/side/bandUnified'

/** 颜色字面量：只放行 hex 与 rgb()/rgba()，避免任意字符串被当作样式值 */
const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/iu
const RGB_COLOR_PATTERN = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/iu

/** 是否为普通对象：数组与 null 都排除在外 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 仅接受字符串与数字并转文本，其余类型返回空串 */
function toText(value: unknown): string {
    return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

/** 空串归一为 null：契约里「无此标记」只用一个值表达 */
function toOptionalText(value: unknown): string | null {
    const text = toText(value).trim()
    return text.length > 0 ? text : null
}

/** 收窄徽标底色：非法或缺失一律 null，由前端回落到默认徽标样式 */
export function normalizeHotRankColor(value: unknown): string | null {
    const text = toText(value).trim()
    if (text.length === 0) {
        return null
    }
    return HEX_COLOR_PATTERN.test(text) || RGB_COLOR_PATTERN.test(text) ? text : null
}

/** 构造榜单地址：last_tab_time 取当前秒级时间戳，与网页端一致 */
export function buildHotRankUrl(now: Date): string {
    const url = new URL(HOT_RANK_PATH, WEIBO_WEB_ORIGIN)
    url.searchParams.set('type', 'mine')
    url.searchParams.set('last_tab', 'mine')
    url.searchParams.set('last_tab_time', String(Math.floor(now.getTime() / 1000)))
    return url.toString()
}

/** 读取 realtime 数组：顶层优先，缺失时在 band_list 里找第一个含 realtime 的分区 */
function readRealtimeList(record: Record<string, unknown>): unknown[] {
    const container = isRecord(record.data) ? record.data : record
    if (Array.isArray(container.realtime)) {
        return container.realtime
    }
    const bands = Array.isArray(container.band_list) ? container.band_list : []
    for (const band of bands) {
        if (isRecord(band) && Array.isArray(band.realtime)) {
            return band.realtime
        }
    }
    return []
}

/** 读取正整数：名次与 realpos 不允许 0 或负数 */
function toPositiveInt(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : null
}

/** 读取非负整数：rank 是 0 起的数组序号，0 合法 */
function toNonNegativeInt(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null
}

/** 推广标记关键字：上游给投放 / 活动话题打的 icon_desc，命中即不进榜（「商」= 商业投放，「上新」= 品牌活动位） */
const PROMOTED_ICON_DESC_KEYWORDS: readonly string[] = ['商', '上新']

/** 广告与推广条目不进热搜榜：它们没有稳定名次，混进去会挤掉真实排名 */
function isPromoted(value: Record<string, unknown>): boolean {
    if (value.is_ad === 1 || value.is_ad === true || value.ad_state === 1) {
        return true
    }
    // 部分投放位不带 is_ad，只把 icon_desc 标成「商」「上新」；label_name 与 icon_desc 互为兜底，口径与 normalizeHotRankItem 一致
    const iconDesc = toOptionalText(value.icon_desc) ?? toOptionalText(value.label_name)
    return iconDesc !== null && PROMOTED_ICON_DESC_KEYWORDS.some((keyword) => iconDesc.includes(keyword))
}

/**
 * 读取名次：realpos 是网页端的真实排名（1 起），rank 是 0 起的数组序号；
 * 两者都缺失时才回落到数组下标 +1。
 */
function readRank(value: Record<string, unknown>, fallbackRank: number): number {
    const realpos = toPositiveInt(value.realpos)
    if (realpos !== null) {
        return realpos
    }
    const rank = toNonNegativeInt(value.rank)
    return rank === null ? fallbackRank : rank + 1
}

/** 归一化单条榜单：标题缺失即不可展示，其余字段按需保留 */
function normalizeHotRankItem(value: Record<string, unknown>, fallbackRank: number): WeiboHotRankItem | null {
    // word_scheme 与网页端展示一致（话题词自带 #号），缺失时回落到 note / word / title
    const title = toText(value.word_scheme) || toText(value.note) || toText(value.word) || toText(value.title)
    if (title.length === 0) {
        return null
    }
    return {
        rank: readRank(value, fallbackRank),
        title,
        description: toOptionalText(value.description),
        // 图标字段在不同版本里叫 icon 或 icon_url：两者都收，优先 icon_url
        iconUrl: normalizeWeiboImageUrl(toText(value.icon_url) || toText(value.icon)),
        // 标记文案以 icon_desc 为准，缺失时回落 label_name（两者在上游通常一致）
        iconDesc: toOptionalText(value.icon_desc) ?? toOptionalText(value.label_name),
        iconDescColor: normalizeHotRankColor(value.icon_desc_color),
    }
}

/**
 * 提取榜单条目。
 * 序号优先取上游 realpos，被过滤的广告条目不会让后续名次前移；缺标题的条目同样丢弃。
 */
export function extractWeiboHotRank(record: Record<string, unknown>): WeiboHotRankItem[] {
    const items: WeiboHotRankItem[] = []
    const list = readRealtimeList(record)
    for (const [index, value] of list.entries()) {
        if (!isRecord(value) || isPromoted(value)) {
            continue
        }
        const item = normalizeHotRankItem(value, index + 1)
        if (item !== null) {
            items.push(item)
        }
    }
    return items
}

/** 热搜榜取数入参：requestJson 由单测注入，生产走真实请求 */
export interface FetchHotRankOptions {
    cookie: string
    timeoutMs?: number
    minIntervalMs?: number
    requestJson?: (query: WeiboJsonQuery) => Promise<WeiboJsonResponse>
    now?: () => Date
}

/** 读取热搜榜：结构异常（没有可用条目）按失败处理，避免侧栏展示空榜 */
export async function fetchWeiboHotRank(options: FetchHotRankOptions): Promise<WeiboHotRankResult> {
    const requestJson = options.requestJson ?? requestWeiboJson
    const now = options.now ?? ((): Date => new Date())
    const { record } = await requestJson({
        url: buildHotRankUrl(now()),
        cookie: options.cookie,
        timeoutMs: options.timeoutMs,
        minIntervalMs: options.minIntervalMs,
    })
    const items = extractWeiboHotRank(record)
    if (items.length === 0) {
        throw new WeiboWebError('invalid-payload', '微博返回结构异常：没有可用的热搜条目')
    }
    return { items, fetchedAt: now().toISOString() }
}
