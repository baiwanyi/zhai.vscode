/**
 * 微博话题搜索：GET /ajax/mblog/topic?q=关键字，q 为空时上游回当前账号的常用话题。
 * 复用约定：请求走 webClient 的通用 JSON 通道（同一套请求头、节流与错误分类），
 * 关键字只经 URLSearchParams 追加，不做字符串拼接，也不容忍任意路径。
 * 关键约束：只取 data[].topic，其余字段一律忽略；空串与重复话题在归一化时剔除；
 * 回空列表按正常结果返回（新账号或搜不到就是空数组），由前端展示空态而不是报错。
 */
import type { WeiboTopicsResult } from '@shared/types/weibo'
import type { WeiboJsonQuery, WeiboJsonResponse } from '../transport/httpClient'
import { WEIBO_AJAX_PATHS, WEIBO_WEB_ORIGIN } from '../endpoints'
import { isRecord } from '../guards'
import { WeiboWebError, requestWeiboJson } from '../transport/httpClient'

/** 归一化话题名：去首尾空白，剥掉上游可能自带的 # 号，空串按无效处理 */
function normalizeTopic(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null
    }
    const text = value.trim().replace(/^#+/u, '').replace(/#+$/u, '').trim()
    return text.length > 0 ? text : null
}

/** 提取话题列表：保持上游顺序，已出现的同名话题只保留首个 */
export function extractWeiboTopics(record: Record<string, unknown>): string[] {
    if (!Array.isArray(record.data)) {
        return []
    }
    const topics: string[] = []
    const seen = new Set<string>()
    for (const entry of record.data) {
        if (!isRecord(entry)) {
            continue
        }
        const topic = normalizeTopic(entry.topic)
        if (topic === null || seen.has(topic)) {
            continue
        }
        seen.add(topic)
        topics.push(topic)
    }
    return topics
}

/** 话题取数入参：requestJson 由单测注入，生产走真实请求 */
export interface FetchTopicsOptions {
    cookie: string
    /** 搜索关键字：空串或缺失表示取常用话题 */
    q?: string
    timeoutMs?: number
    minIntervalMs?: number
    requestJson?: (query: WeiboJsonQuery) => Promise<WeiboJsonResponse>
}

/** 读取话题列表：结构不符时按失败处理，避免前端把改版当成「没有话题」 */
export async function fetchWeiboTopics(options: FetchTopicsOptions): Promise<WeiboTopicsResult> {
    const requestJson = options.requestJson ?? requestWeiboJson
    const url = new URL(WEIBO_AJAX_PATHS.topic, WEIBO_WEB_ORIGIN)
    const query = options.q?.trim() ?? ''
    if (query.length > 0) {
        url.searchParams.set('q', query)
    }
    const { record } = await requestJson({
        url: url.toString(),
        cookie: options.cookie,
        timeoutMs: options.timeoutMs,
        minIntervalMs: options.minIntervalMs,
    })
    if (!Array.isArray(record.data)) {
        // 把实际返回的字段名带进错误：接口改版时不用逐层打印就能定位新的键
        const keys = Object.keys(record).slice(0, 10).join('、')
        throw new WeiboWebError(
            'invalid-payload',
            `微博返回结构异常：没有可用的话题列表（返回字段：${keys.length > 0 ? keys : '空'}）`,
        )
    }
    return { topics: extractWeiboTopics(record) }
}
