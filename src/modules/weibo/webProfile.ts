/**
 * 微博账号信息：把网页端 profile/info 的 user 对象收敛成顶栏账号菜单所需的字段。
 * 复用约定：请求走 webClient 的通用 JSON 通道（同一套请求头、节流与错误分类），
 * 头像地址过 webTimeline 的图床白名单，简介复用 stripWeiboHtml 清洗。
 * 关键约束：缺 id 或昵称即视为不可用（渲染层没有可展示的主体）；
 * 头像优先 avatar_hd → avatar_large → profile_image_url，且只保留白名单内的 https 地址。
 */
import { isWeiboTimelineId } from '@shared/types/weibo'
import type { WeiboProfile } from '@shared/types/weibo'
import { WEIBO_WEB_ORIGIN, WeiboWebError, requestWeiboJson, toIdString } from './webClient'
import { normalizeWeiboImageUrl, stripWeiboHtml } from './webTimeline'
import type { WeiboJsonQuery, WeiboJsonResponse } from './webClient'

/** 账号信息端点：网页端个人主页同源接口，uid 为当前登录账号 */
const PROFILE_PATH = '/ajax/profile/info'

/** 是否为普通对象：数组与 null 都排除在外 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 仅接受字符串与数字并转文本，其余类型返回空串 */
function toText(value: unknown): string {
    return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

/** 计数取值：非正数或非有限数一律按 0 */
function toCount(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0
}

/** 构造账号信息地址：uid 与 scene 都按网页端口径给定 */
export function buildProfileUrl(uid: string): string {
    const url = new URL(PROFILE_PATH, WEIBO_WEB_ORIGIN)
    url.searchParams.set('uid', uid)
    url.searchParams.set('scene', 'profile')
    return url.toString()
}

/**
 * 归一化账号信息：兼容 user 挂在 data 下或顶层两种形态。
 * 返回 null 表示结构不可用，由调用方统一报错，不做尽力而为的修补。
 */
export function normalizeWeiboProfile(record: Record<string, unknown>): WeiboProfile | null {
    const container = isRecord(record.data) ? record.data : record
    const user = isRecord(container.user) ? container.user : null
    if (user === null) {
        return null
    }
    const id = toIdString(user.id) ?? toIdString(user.idstr) ?? ''
    const name = toText(user.screen_name).trim()
    if (!isWeiboTimelineId(id) || name.length === 0) {
        return null
    }
    const avatar = toText(user.avatar_hd) || toText(user.avatar_large) || toText(user.profile_image_url)
    return {
        id,
        name,
        avatarUrl: normalizeWeiboImageUrl(avatar) ?? '',
        isVerified: user.verified === true,
        description: stripWeiboHtml(toText(user.description)),
        followersCount: toCount(user.followers_count),
        friendsCount: toCount(user.friends_count),
        statusesCount: toCount(user.statuses_count),
    }
}

/** 账号信息取数入参：requestJson 由单测注入，生产走真实请求 */
export interface FetchProfileOptions {
    cookie: string
    /** 当前登录账号 uid：来自 weibo/groups */
    uid: string
    timeoutMs?: number
    minIntervalMs?: number
    requestJson?: (query: WeiboJsonQuery) => Promise<WeiboJsonResponse>
}

/** 读取账号信息：结构异常按失败处理，避免顶栏展示一个空账号 */
export async function fetchWeiboProfile(options: FetchProfileOptions): Promise<WeiboProfile> {
    const requestJson = options.requestJson ?? requestWeiboJson
    const { record } = await requestJson({
        url: buildProfileUrl(options.uid),
        cookie: options.cookie,
        timeoutMs: options.timeoutMs,
        minIntervalMs: options.minIntervalMs,
    })
    const profile = normalizeWeiboProfile(record)
    if (profile === null) {
        throw new WeiboWebError('invalid-payload', '微博返回结构异常：没有可用的账号信息')
    }
    return profile
}
