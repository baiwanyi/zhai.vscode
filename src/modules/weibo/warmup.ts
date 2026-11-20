/**
 * 微博元数据预热：激活后把分组、热搜与表情各取一次并写入 {存储根}/weibo.json。
 * 复用约定：凭证经 WeiboCookieStore 读取，取数复用路由同款的 fetchWeiboGroups / fetchWeiboHotRank /
 * fetchWeiboEmoticons，落盘交给 weiboCache；调用方只管派发，不必等它完成。
 * 关键约束：串行执行——webClient 的 1.2s 节流依赖模块级时间戳，并发调用会同时放行而失去节流；
 * 同一账号 15 分钟内不重复预热；凭证缺失、取数失败一律静默，只记 warn，不弹窗也不阻断激活。
 */
import { logger } from '@modules/common/logger'
import type { WeiboProfile } from '@shared/types/weibo'
import { isCookieUsable } from './webCredential'
import { fetchWeiboEmoticons } from './webEmoticons'
import { fetchWeiboGroups } from './webFeed'
import { fetchWeiboHotRank } from './webHotRank'
import { fetchWeiboProfile } from './webProfile'
import { toAccountKey } from './weiboCache'
import type { WeiboCookieStore } from './webCredential'
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

/** 单项预热：失败只记一条 warn，不影响其余两项 */
async function runQuietly(label: string, task: () => Promise<void>): Promise<void> {
    try {
        await task()
    } catch (error) {
        logger.warn(`微博预热「${label}」失败：${error instanceof Error ? error.message : String(error)}`)
    }
}

/**
 * 预热入口：凭证缺失直接返回，冷却期内跳过，三项串行执行。
 * 关键约束：先记时刻再取数——网络异常时也计入间隔，避免每次激活都重试同一批请求。
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
        await options.cache.markWarmed(accountKey)
        // 账号信息依赖分组里的 uid：先取分组，再拿它的 uid 去取资料
        let uid: string | null = null
        await runQuietly('分组', async (): Promise<void> => {
            const result = await fetchWeiboGroups({ cookie })
            uid = result.uid
            await options.cache.write('groups', accountKey, result, now().toISOString())
        })
        await runQuietly('账号信息', async (): Promise<void> => {
            const cachedGroups = await options.cache.readGroups(accountKey)
            const resolved = uid ?? cachedGroups?.data.uid ?? null
            if (resolved === null) {
                return
            }
            const fetchProfile = options.fetchProfile ?? fetchWeiboProfile
            const profile = await fetchProfile({ cookie, uid: resolved })
            await options.cache.write('profile', accountKey, profile, now().toISOString())
            // 头像单独落盘：{存储根}/weibo_avatar.jpg，大图与失效地址都不进 weibo.json
            if (options.avatar !== undefined) {
                await options.avatar.download(profile.avatarUrl)
            }
        })
        await runQuietly('热搜', async (): Promise<void> => {
            const result = await fetchWeiboHotRank({ cookie })
            await options.cache.write('hotRank', accountKey, result, result.fetchedAt)
        })
        await runQuietly('表情', async (): Promise<void> => {
            const result = await fetchWeiboEmoticons({ cookie })
            await options.cache.write('emoticons', accountKey, result, result.fetchedAt)
        })
    } catch (error) {
        logger.warn(`微博元数据预热失败：${error instanceof Error ? error.message : String(error)}`)
    }
}
