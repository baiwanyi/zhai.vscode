/**
 * 微博表情配置：只读取 data.emoticon.ZH_CN 下的「分类 → 表情数组」。
 * 复用约定：请求走 webClient 的通用 JSON 通道（同一套请求头、节流与错误分类），
 * 图地址统一过 webTimeline 的 normalizeWeiboImageUrl 收窄，分类名原样写入 category。
 * 关键约束：仅此一种结构，不再兼容别名映射（emoticonRender）等其它字段；
 * 单条必须同时具备 phrase 与合法图地址，类内重复 phrase 以首见为准、跨类重复保留；
 * 拿不到任何条目时把实际返回字段名带进错误，便于接口改版时定位。
 */
import type { WeiboEmoticonItem, WeiboEmoticonsResult } from '@shared/types/weibo'
import { WEIBO_WEB_ORIGIN, WeiboWebError, requestWeiboJson } from './webClient'
import { normalizeWeiboImageUrl } from './webTimeline'
import type { WeiboJsonQuery, WeiboJsonResponse } from './webClient'

/** 表情配置端点：网页端发表框的表情面板同源接口 */
const EMOTICONS_PATH = '/ajax/statuses/config'

/** 中文表情表的位置：data.emoticon.ZH_CN.<分类>[{ phrase, url }] */
const EMOTICON_LOCALE_KEY = 'ZH_CN'

/** 是否为普通对象：数组与 null 都排除在外 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 仅接受字符串与数字并转文本，其余类型返回空串 */
function toText(value: unknown): string {
    return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

/** 归一化单条表情：phrase 与图地址缺一不可，分类由所在分组直接给出 */
function normalizeEmoticon(value: unknown, category: string): WeiboEmoticonItem | null {
    if (!isRecord(value)) {
        return null
    }
    const phrase = toText(value.phrase)
    const url = normalizeWeiboImageUrl(toText(value.url))
    if (phrase.length === 0 || url === null) {
        return null
    }
    return { phrase, url, category }
}

/**
 * 提取表情列表：遍历 ZH_CN 下的每个分类数组，类内按 phrase 去重。
 * 结构不是预期形态时返回空数组，由调用方统一报错。
 */
export function extractWeiboEmoticons(record: Record<string, unknown>): WeiboEmoticonItem[] {
    if (!isRecord(record.data) || !isRecord(record.data.emoticon)) {
        return []
    }
    const locale = record.data.emoticon[EMOTICON_LOCALE_KEY]
    if (!isRecord(locale)) {
        return []
    }
    const items: WeiboEmoticonItem[] = []
    for (const [category, group] of Object.entries(locale)) {
        if (!Array.isArray(group)) {
            continue
        }
        const seen = new Set<string>()
        for (const entry of group) {
            const item = normalizeEmoticon(entry, category)
            if (item === null || seen.has(item.phrase)) {
                continue
            }
            seen.add(item.phrase)
            items.push(item)
        }
    }
    return items
}

/** 表情取数入参：requestJson 由单测注入，生产走真实请求 */
export interface FetchEmoticonsOptions {
    cookie: string
    timeoutMs?: number
    minIntervalMs?: number
    requestJson?: (query: WeiboJsonQuery) => Promise<WeiboJsonResponse>
    now?: () => Date
}

/** 读取表情配置：结构不符时按失败处理，避免前端展示空面板 */
export async function fetchWeiboEmoticons(options: FetchEmoticonsOptions): Promise<WeiboEmoticonsResult> {
    const requestJson = options.requestJson ?? requestWeiboJson
    const now = options.now ?? ((): Date => new Date())
    const url = new URL(EMOTICONS_PATH, WEIBO_WEB_ORIGIN).toString()
    const { record } = await requestJson({
        url,
        cookie: options.cookie,
        timeoutMs: options.timeoutMs,
        minIntervalMs: options.minIntervalMs,
    })
    const emoticons = extractWeiboEmoticons(record)
    if (emoticons.length === 0) {
        // 把实际返回的字段名带进错误：接口改版时不用逐层打印就能定位新的键
        const container = isRecord(record.data) ? record.data : record
        const keys = Object.keys(container).slice(0, 10).join('、')
        throw new WeiboWebError(
            'invalid-payload',
            `微博返回结构异常：没有可用的表情（返回字段：${keys.length > 0 ? keys : '空'}）`,
        )
    }
    return { emoticons, fetchedAt: now().toISOString() }
}
