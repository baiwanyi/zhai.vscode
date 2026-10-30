/**
 * 用户管理服务：关注者列表与标签列表。
 * 复用约定：Token 走 accountToken，接口走 openapi；不做本地落库——粉丝数据变化快，
 * 缓存会让人误以为看到的是实时状态，而 datacube 之外的列表接口本身允许随时拉取。
 * 关键约束：平台单页最多返回 1 万个 openid，但批量资料接口一次只接受 100 个，
 * 因此本期只展示首屏 100 位并在界面注明总人数，不做游标翻页（游标与批量上限会错位，翻页必然漏人）；
 * 未关注用户（已取关）只保留 openid 与状态，昵称头像留空，界面按「已取关」标注。
 */
import type {
    WechatFanListRequest,
    WechatFanListResult,
    WechatFanSummary,
    WechatFanTagsResult,
} from '@shared/types/wechat'
import { requireWechatToken } from './accountToken'
import { fetchWechatFanPage, fetchWechatFanProfiles, fetchWechatTags } from './openapi'
import type { WechatTokenAccessDeps } from './accountToken'

/** 单次批量资料请求的 openid 上限（平台限制） */
const PROFILE_BATCH_LIMIT = 100

export class WechatFanService {
    public constructor(private readonly deps: WechatTokenAccessDeps) {}

    /**
     * 关注者列表：先取 openid，再批量补昵称与头像。
     * 关键约束：只看首页 100 位；资料接口失败时降级为「只有 openid」的列表，而不是整页报错，
     * 因为 openid 列表本身已经可用，昵称缺失只影响可读性。
     */
    public async list(request: WechatFanListRequest): Promise<WechatFanListResult> {
        const { accessToken } = await requireWechatToken(this.deps, request.accountId)
        const page = await fetchWechatFanPage(accessToken, request.nextOpenid)
        if (!page.ok) {
            throw new Error(page.message)
        }
        const openids = page.data.openids.slice(0, PROFILE_BATCH_LIMIT)
        if (openids.length === 0) {
            return { fans: [], total: page.data.total }
        }

        const profiles = await fetchWechatFanProfiles(accessToken, openids)
        if (!profiles.ok) {
            return {
                fans: openids.map((openid) => ({ openid, nickname: '', subscribeStatus: 1 })),
                total: page.data.total,
            }
        }
        const byOpenid = new Map(profiles.data.map((profile) => [profile.openid, profile]))
        const fans: WechatFanSummary[] = openids.map((openid) => {
            const profile = byOpenid.get(openid)
            if (profile === undefined) {
                return { openid, nickname: '', subscribeStatus: 0 }
            }
            return {
                openid,
                nickname: profile.nickname.length > 0 ? profile.nickname : openid.slice(0, 8),
                ...(profile.avatar === undefined ? {} : { avatar: profile.avatar }),
                subscribeStatus: profile.subscribeStatus,
                ...(profile.subscribedAt === undefined ? {} : { subscribedAt: profile.subscribedAt }),
            }
        })
        return { fans, total: page.data.total }
    }

    /** 标签列表：数量为平台统计，未打标用户不在任何标签内 */
    public async tags(accountId: string): Promise<WechatFanTagsResult> {
        const { accessToken } = await requireWechatToken(this.deps, accountId)
        const outcome = await fetchWechatTags(accessToken)
        if (!outcome.ok) {
            throw new Error(outcome.message)
        }
        return { tags: outcome.data.map((row) => ({ id: row.id, name: row.name, count: row.count })) }
    }
}
