/**
 * 微博元数据预热：激活后把分组、热搜与表情各取一次并写入 {存储根}/weibo.json。
 * 复用约定：凭证经 WeiboCookieStore 读取，取数复用路由同款的 fetchWeiboGroups / fetchWeiboHotRank /
 * fetchWeiboEmoticons，落盘交给 weiboCache；调用方只管派发，不必等它完成。
 * 关键约束：串行执行——webClient 的 1.2s 节流依赖模块级时间戳，并发调用会同时放行而失去节流；
 * 至少一项成功后才记 15 分钟冷却：全部失败不留冷却，下次激活可自愈（断网不会让缓存空半天）；
 * 凭证缺失、取数失败一律静默，只记 warn，不弹窗也不阻断激活。
 */
import { logger } from '@modules/common/logger'
import type { WeiboEmoticonsResult, WeiboGroupsResult, WeiboHotRankResult, WeiboProfile } from '@shared/types/weibo'
import { isCookieUsable } from './webCredential'
import { fetchWeiboEmoticons } from './webEmoticons'
import { fetchWeiboGroups } from './webFeed'
import { fetchWeiboHotRank } from './webHotRank'
import { fetchWeiboProfile } from './webProfile'
import { toAccountKey } from './weiboCache'
import type { WeiboCookieStore } from './webCredential'
import type { FetchEmoticonsOptions } from './webEmoticons'
import type { FetchGroupsOptions } from './webFeed'
import type { FetchHotRankOptions } from './webHotRank'
import type { FetchProfileOptions } from './webProfile'
import type { WeiboAvatarGateway } from './weiboAvatar'
import type { WeiboCache } from './weiboCache'

/** 同一账号的预热间隔：开发时反复 Reload Window 不该每次都打三个接口 */
const WARMUP_MIN_INTERVAL_MS = 15 * 60 * 1000

/** 预热依赖：凭证读取、缓存写入与头像网关都从外部注入，便于单测替身 */
export interface WarmWeiboOptions {
    cookieStore: WeiboCookieStore
    cache: WeiboCache
    /** 头像网关：未注入时只写用户信息，不下载头像 */
    avatar?: WeiboAvatarGateway
    /** 账号信息取数：单测可替换，默认走网页版 profile/info */
    fetchProfile?: (options: FetchProfileOptions) => Promise<WeiboProfile>
    /** 分组取数：单测可替换，默认走 webFeed 的 fetchWeiboGroups */
    fetchGroups?: (options: FetchGroupsOptions) => Promise<WeiboGroupsResult>
    /** 热搜取数：单测可替换，默认走 webHotRank 的 fetchWeiboHotRank */
    fetchHotRank?: (options: FetchHotRankOptions) => Promise<WeiboHotRankResult>
    /** 表情取数：单测可替换，默认走 webEmoticons 的 fetchWeiboEmoticons */
    fetchEmoticons?: (options: FetchEmoticonsOptions) => Promise<WeiboEmoticonsResult>
    now?: () => Date
}

/** 是否仍在冷却期内：上次时刻不可解析按「从未预热」处理，宁可多取一次 */
function isCoolingDown(warmedAt: string | null, now: Date): boolean {
    if (warmedAt === null) {
        return false
    }
    const last = Date.parse(warmedAt)
    return Number.isFinite(last) && now.getTime() - last < WARMUP_MIN_INTERVAL_MS
}

/**
 * 单项预热：失败只记一条 warn，不影响其余项。
 * 返回值表示「是否真的取到了数据」——提前跳过（例如拿不到 uid）算未成功，避免冷却被空跑占掉。
 */
async function runQuietly(label: string, task: () => Promise<boolean>): Promise<boolean> {
    try {
        return await task()
    } catch (error) {
        logger.warn(`微博预热「${label}」失败：${error instanceof Error ? error.message : String(error)}`)
        return false
    }
}

/**
 * 预热入口：凭证缺失直接返回，冷却期内跳过，四项串行执行。
 * 关键约束：至少一项真正取到数据才记冷却时刻——全部失败或全部提前跳过时不留冷却，
 * 否则一次断网会让缓存空置整整 15 分钟，用户只能等或重装。
 */
export async function warmWeiboMetadata(options: WarmWeiboOptions): Promise<void> {
    const now = options.now ?? ((): Date => new Date())
    try {
        const cookie = await options.cookieStore.read()
        if (!isCookieUsable(cookie)) {
            return
        }
        const accountKey = toAccountKey(cookie)
        const warmedAt = await options.cache.readWarmedAt(accountKey)
        if (isCoolingDown(warmedAt, now())) {
            return
        }
        // 账号信息依赖分组里的 uid：先取分组，再拿它的 uid 去取资料
        let uid: string | null = null
        let succeeded = 0
        if (
            await runQuietly('分组', async (): Promise<boolean> => {
                const result = await (options.fetchGroups ?? fetchWeiboGroups)({ cookie })
                uid = result.uid
                await options.cache.write('groups', accountKey, result, now().toISOString())
                return true
            })
        ) {
            succeeded += 1
        }
        if (
            await runQuietly('账号信息', async (): Promise<boolean> => {
                const cachedGroups = await options.cache.readGroups(accountKey)
                const resolved = uid ?? cachedGroups?.data.uid ?? null
                if (resolved === null) {
                    return false
                }
                const fetchProfile = options.fetchProfile ?? fetchWeiboProfile
                const profile = await fetchProfile({ cookie, uid: resolved })
                await options.cache.write('profile', accountKey, profile, now().toISOString())
                // 头像单独落盘：{存储根}/weibo_avatar.jpg，大图与失效地址都不进 weibo.json
                if (options.avatar !== undefined) {
                    await options.avatar.download(profile.avatarUrl)
                }
                return true
            })
        ) {
            succeeded += 1
        }
        if (
            await runQuietly('热搜', async (): Promise<boolean> => {
                const result = await (options.fetchHotRank ?? fetchWeiboHotRank)({ cookie })
                await options.cache.write('hotRank', accountKey, result, result.fetchedAt)
                return true
            })
        ) {
            succeeded += 1
        }
        if (
            await runQuietly('表情', async (): Promise<boolean> => {
                const result = await (options.fetchEmoticons ?? fetchWeiboEmoticons)({ cookie })
                await options.cache.write('emoticons', accountKey, result, result.fetchedAt)
                return true
            })
        ) {
            succeeded += 1
        }
        // 全部失败不留冷却：下次激活会重新尝试，避免一次断网把缓存空置 15 分钟
        if (succeeded > 0) {
            await options.cache.markWarmed(accountKey)
        }
    } catch (error) {
        logger.warn(`微博元数据预热失败：${error instanceof Error ? error.message : String(error)}`)
    }
}
