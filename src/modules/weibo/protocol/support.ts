/**
 * 微博协议层的共享支撑：凭证读取、账号元数据缓存、头像回读与长文补全等横切动作。
 * 复用约定：缓存键与账号指纹统一由本层计算，各 handler 只关心「读什么、写什么、何时失效」；
 * 缓存读写失败一律降级，绝不把存储问题升级成协议错误。
 * 关键约束：readCookie 是唯一凭证入口，缺失即抛带分类码的错误；
 * 长文补全只对已标记截断的帖子发起，取不到全文时保留摘要，不阻断笔记与对话动作。
 */
import { logger } from '@modules/common/logger'
import type {
    WeiboEmoticonsResult,
    WeiboGroupsResult,
    WeiboHotRankResult,
    WeiboLongTextResult,
    WeiboPagePostPayload,
    WeiboProfile,
} from '@shared/types/weibo'
import { isWeiboLongTextRequest } from '@shared/types/weibo'
import type { WeiboCacheKey } from '../store/metadataCache'
import type { WeiboRouteDeps } from './deps'
import { fetchLongText } from '../api/longText'
import { isCookieUsable } from '../store/credential'
import { toAccountKey } from '../store/metadataCache'
import { WeiboWebError } from '../transport/httpClient'

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

/** 协议层共享支撑：所有 handler 共用一个实例，状态只读（依赖与缓存句柄） */
export class RouteSupport {
    public constructor(private readonly deps: WeiboRouteDeps) {}

    /** 读取登录 Cookie：缺失时抛带分类码的错误，避免每个方法各写一遍同样的判断 */
    public async readCookie(): Promise<string> {
        const cookie = await this.deps.cookieStore.read()
        if (!isCookieUsable(cookie)) {
            throw new WeiboWebError('no-credential', '尚未配置微博 Cookie：请先登录 weibo.com 并粘贴请求头中的 Cookie')
        }
        return cookie
    }

    /** 账号指纹：缓存按账号隔离，换号后自然不命中 */
    public accountKey(cookie: string): string {
        return toAccountKey(cookie)
    }

    /** 读分组缓存：命中即返回归一化后的回包，未命中返回 null 由调用方回源 */
    public async readCachedGroups(accountKey: string): Promise<WeiboGroupsResult | null> {
        const cache = this.deps.cache
        if (cache === undefined) {
            return null
        }
        const entry = await readQuietly('groups', async () => cache.readGroups(accountKey))
        return entry === null ? null : entry.data
    }

    /** 读热搜缓存：账号不符或过期都按未命中处理 */
    public async readCachedHotRank(accountKey: string): Promise<WeiboHotRankResult | null> {
        const cache = this.deps.cache
        if (cache === undefined) {
            return null
        }
        const entry = await readQuietly('hotRank', async () => cache.readHotRank(accountKey))
        return entry === null ? null : entry.data
    }

    /** 读表情缓存：账号不符或过期都按未命中处理 */
    public async readCachedEmoticons(accountKey: string): Promise<WeiboEmoticonsResult | null> {
        const cache = this.deps.cache
        if (cache === undefined) {
            return null
        }
        const entry = await readQuietly('emoticons', async () => cache.readEmoticons(accountKey))
        return entry === null ? null : entry.data
    }

    /** 读账号信息缓存：账号不符或过期都按未命中处理 */
    public async readCachedProfile(accountKey: string): Promise<WeiboProfile | null> {
        const cache = this.deps.cache
        if (cache === undefined) {
            return null
        }
        const entry = await readQuietly('profile', async () => cache.readProfile(accountKey))
        return entry === null ? null : entry.data
    }

    /** 写缓存：不等待落盘，失败只记日志——缓存问题不应影响本次回包 */
    public saveCache(key: WeiboCacheKey, accountKey: string, data: unknown, fetchedAt: string): void {
        const cache = this.deps.cache
        if (cache === undefined) {
            return
        }
        writeQuietly(key, cache.write(key, accountKey, data, fetchedAt))
    }

    /**
     * 失效分组缓存：分组 / 备注写完后调用，避免写后读拿到旧快照（用户会以为没保存成功）。
     * 关键约束：失效失败只记日志——缓存问题不该把一次已成功的写入变成失败回包。
     */
    public async invalidateGroups(cookie: string): Promise<void> {
        const cache = this.deps.cache
        if (cache?.invalidateGroups === undefined) {
            return
        }
        try {
            await cache.invalidateGroups(toAccountKey(cookie))
        } catch (error) {
            logger.warn(`微博分组缓存失效失败：${error instanceof Error ? error.message : String(error)}`)
        }
    }

    /** 取当前账号 uid：优先分组缓存，缺失时回源一次分组（loadGroups 内部会写缓存） */
    public async resolveProfileUid(
        cookie: string,
        loadGroups: () => Promise<WeiboGroupsResult>,
    ): Promise<string | null> {
        const cached = await this.readCachedGroups(toAccountKey(cookie))
        if (cached !== null && cached.uid !== null) {
            return cached.uid
        }
        const groups = await loadGroups()
        return groups.uid
    }

    /** 读本地头像：未注入网关时返回 null，账号菜单回落为昵称首字 */
    public async readAvatar(): Promise<string | null> {
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
    public async downloadAvatar(avatarUrl: string): Promise<string | null> {
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

    /**
     * 长文补全：主贴与转发体被截断时先取全文再存档。
     * 关键约束：非长文不发任何请求；取全文失败只记日志并保留摘要，不阻断保存（笔记里已有截断说明）。
     */
    public async expandLongText(post: WeiboPagePostPayload): Promise<WeiboPagePostPayload> {
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
            const raw = { id }
            if (!isWeiboLongTextRequest(raw)) {
                return null
            }
            const cookie = await this.readCookie()
            const load = this.deps.fetchLongText ?? fetchLongText
            const result: WeiboLongTextResult = await load({ cookie, id: raw.id })
            return result.text.length > 0 ? result.text : null
        } catch (error) {
            logger.warn(
                `保存笔记前取全文失败，保留摘要：${id}（${error instanceof Error ? error.message : String(error)}）`,
            )
            return null
        }
    }
}
