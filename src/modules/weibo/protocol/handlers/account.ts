/**
 * 微博协议·账号与偏好域：账号信息与头像、同城城市、屏蔽名单、登录凭证生命周期。
 * 复用约定：配置读写经 deps 注入（落到 VS Code 配置），凭证落 SecretStorage，缓存与头像副作用交给 RouteSupport；
 * 用户信息走 weibo.json 缓存，头像单独落本地文件，两者互不阻塞。
 * 关键约束：Cookie 只写不读回前端，凭证状态仅暴露「是否已配置 + 保存时间」；
 * 清除凭证必须连带清理元数据缓存、图片缓存与本地头像，避免换号后露出上一账号的数据。
 */
import {
    WEIBO_DEFAULT_CITY_CODE,
    isWeiboCityCode,
    isWeiboProfileRequest,
    isWeiboSaveBlockListRequest,
    isWeiboSaveCityRequest,
    isWeiboSaveCredentialRequest,
    readWeiboCityName,
} from '@shared/types/weibo'
import type {
    WeiboBlockListState,
    WeiboCityState,
    WeiboClearCredentialResult,
    WeiboCredentialState,
    WeiboGroupsResult,
    WeiboProfileResult,
    WeiboSaveCredentialResult,
} from '@shared/types/weibo'
import { WEIBO_METHODS } from '@shared/types/weiboMethods'
import { normalizeWeiboBlockList } from '@shared/utils/weiboBlock'
import type { WeiboRouteDeps } from '../deps'
import type { RouteSupport } from '../support'
import { fetchWeiboProfile } from '../../api/profile'
import { isCookieUsable, normalizeCookieInput } from '../../store/credential'
import { WeiboWebError } from '../../transport/httpClient'

/** 账号与偏好域处理器：配置类写入幂等，凭证类动作带完整副作用清理 */
export class AccountHandlers {
    public constructor(
        private readonly deps: WeiboRouteDeps,
        private readonly support: RouteSupport,
        /** 分组读取：账号 uid 的唯一来源，由信息流域提供，避免账号域重复实现缓存策略 */
        private readonly loadGroups: () => Promise<WeiboGroupsResult>,
    ) {}

    /**
     * 读取账号信息与头像：用户信息落 weibo.json，头像落 {存储根}/weibo_avatar.jpg。
     * 关键约束：用户信息命中且本地头像可用时零网络；头像文件缺失但资料在时只重下头像、不重取资料；
     * uid 来自 weibo/groups（分组条目的 uid 即登录账号），取不到时明确报错而不是拼一个空地址。
     */
    public async loadProfile(payload: unknown): Promise<WeiboProfileResult> {
        const raw = payload ?? {}
        if (!isWeiboProfileRequest(raw)) {
            throw new WeiboWebError('invalid-payload', `${WEIBO_METHODS.profile} 参数非法：refresh 须为布尔`)
        }
        const cookie = await this.support.readCookie()
        const accountKey = this.support.accountKey(cookie)
        if (raw.refresh !== true) {
            const cached = await this.support.readCachedProfile(accountKey)
            if (cached !== null) {
                const localAvatar = await this.support.readAvatar()
                // 本地文件在就完全零网络；不在则用缓存里的远程地址补一次下载
                return {
                    profile: cached,
                    avatarDataUrl: localAvatar ?? (await this.support.downloadAvatar(cached.avatarUrl)),
                }
            }
        }
        const fetchProfile = this.deps.fetchProfile ?? fetchWeiboProfile
        const uid = await this.resolveProfileUid(cookie)
        if (uid === null) {
            throw new WeiboWebError('upstream', '无法确定当前账号：分组信息里没有 uid，请重新登录微博后重试')
        }
        const profile = await fetchProfile({ cookie, uid })
        const now = this.deps.now ?? ((): Date => new Date())
        this.support.saveCache('profile', accountKey, profile, now().toISOString())
        return { profile, avatarDataUrl: await this.support.downloadAvatar(profile.avatarUrl) }
    }

    /** 当前账号 uid：优先分组缓存，缺失时回源一次分组（由信息流域的 loadGroups 写缓存） */
    private async resolveProfileUid(cookie: string): Promise<string | null> {
        const cached = await this.support.readCachedGroups(this.support.accountKey(cookie))
        if (cached !== null && cached.uid !== null) {
            return cached.uid
        }
        const groups = await this.loadGroups()
        return groups.uid
    }

    /** 同城城市：配置非法或未注入读写时回落默认城市，保证下拉总有可选值 */
    public readCityState(): WeiboCityState {
        const configured = this.deps.readCityCode?.() ?? ''
        const cityCode = isWeiboCityCode(configured) ? configured : WEIBO_DEFAULT_CITY_CODE
        return { cityCode, cityName: readWeiboCityName(cityCode) }
    }

    /** 保存同城城市：写入配置后回同一结构，前端直接替换本地状态 */
    public async saveCity(payload: unknown): Promise<WeiboCityState> {
        if (!isWeiboSaveCityRequest(payload)) {
            throw new WeiboWebError('invalid-payload', `${WEIBO_METHODS.citySave} 参数非法：cityCode 须为四位数字`)
        }
        await this.deps.writeCityCode?.(payload.cityCode)
        return { cityCode: payload.cityCode, cityName: readWeiboCityName(payload.cityCode) }
    }

    /**
     * 读取屏蔽名单：配置缺省或未注入读取时回空名单，过滤是前端的事，宿主只负责存取。
     * 关键约束：读出的名单一律归一化（去空白、去重、截断超长项），
     * 让设置弹窗里的文本与真实生效的规则始终一致。
     */
    public readBlockListState(): WeiboBlockListState {
        return {
            blockedUsers: this.readBlockListItems(this.deps.readBlockedUsers),
            blockedKeywords: this.readBlockListItems(this.deps.readBlockedKeywords),
        }
    }

    /** 读取单个名单：设置文件被手改成非数组时按空名单处理，不让坏配置连带整个面板报错 */
    private readBlockListItems(read: (() => string[]) | undefined): string[] {
        const items = read?.()
        return normalizeWeiboBlockList(Array.isArray(items) ? items : [])
    }

    /** 保存屏蔽名单：两个名单整份替换，回包与状态同形，前端直接替换本地状态 */
    public async saveBlockList(payload: unknown): Promise<WeiboBlockListState> {
        if (!isWeiboSaveBlockListRequest(payload)) {
            throw new WeiboWebError(
                'invalid-payload',
                `${WEIBO_METHODS.blockListSave} 参数非法：两个名单都须为字符串数组`,
            )
        }
        const list: WeiboBlockListState = {
            blockedUsers: normalizeWeiboBlockList(payload.blockedUsers),
            blockedKeywords: normalizeWeiboBlockList(payload.blockedKeywords),
        }
        await this.deps.writeBlockList?.(list)
        return list
    }

    /** 凭证状态：只回配置标记与保存时间 */
    public async readCredentialState(): Promise<WeiboCredentialState> {
        const cookie = await this.deps.cookieStore.read()
        const savedAt = await this.deps.cookieStore.readSavedAt()
        return {
            isConfigured: isCookieUsable(cookie),
            savedAt: savedAt ?? null,
        }
    }

    /** 保存 Cookie：清洗后写入 SecretStorage，并记录保存时刻 */
    public async saveCredential(payload: unknown): Promise<WeiboSaveCredentialResult> {
        if (!isWeiboSaveCredentialRequest(payload)) {
            throw new WeiboWebError(
                'invalid-payload',
                `${WEIBO_METHODS.credentialSave} 参数非法：cookie 必须为非空字符串`,
            )
        }
        const cookie = normalizeCookieInput(payload.cookie)
        await this.deps.cookieStore.write(cookie)
        const now = this.deps.now ?? ((): Date => new Date())
        const savedAt = now().toISOString()
        await this.deps.cookieStore.writeSavedAt(savedAt)
        return { isConfigured: true, savedAt }
    }

    /** 清除凭证：Cookie、保存时刻、元数据缓存、图片缓存与本地头像一起删除 */
    public async clearCredential(): Promise<WeiboClearCredentialResult> {
        await this.deps.cookieStore.remove()
        await this.deps.cookieStore.removeSavedAt()
        // 缓存里留着旧账号的分组与榜单：一并删除，避免下次换号后命中不属于当前账号的数据
        await this.deps.cache?.clear()
        // 图片缓存同样带账号色彩（正文图与头像原图）：不删则换号后旧内容仍留在磁盘
        await this.deps.clearMediaCache?.()
        // 头像文件也要删：否则换号后顶栏会露出上一个账号的照片
        await this.deps.avatar?.clear()
        return { isConfigured: false }
    }
}
