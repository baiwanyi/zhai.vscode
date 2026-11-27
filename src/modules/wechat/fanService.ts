/**
 * 用户管理服务：列表、检索、详情、标签读取与同步状态。
 * 复用约定：Token 走 accountToken，平台接口走 openapi，本地快照走 db/fanRepository；
 * 列表与标签优先读最近一次同步结果，快照不存在时才回落平台首屏，界面据此区分「已同步」与「实时数据」。
 * 关键约束：平台单页最多返回 1 万个 openid、批量资料接口一次只收 100 个，实时回落仍只取首屏 100 位；
 * UnionID 只在平台返回且有本地快照时出现，未绑定开放平台时按缺省处理；同步的游标与计数由独立服务维护，本服务只读；
 * 黑名单标记由同步流程 getBlacklist 回读写入，实时回落路径一律为 false。
 */
import {
    WECHAT_FAN_BATCH_LIMIT,
    type WechatFanDetailRequest,
    type WechatFanDetailResult,
    type WechatFanListRequest,
    type WechatFanListResult,
    type WechatFanRelatedAccount,
    type WechatFanSearchRequest,
    type WechatFanSearchResult,
    type WechatFanSummary,
    type WechatFanSyncStatusRequest,
    type WechatFanSyncStatusResult,
    type WechatFanSyncTask,
    type WechatFanTag,
    type WechatFanTagsResult,
} from '@shared/types/wechat'
import { requireWechatToken } from './accountToken'
import { listWechatAccounts } from './db/accountRepository'
import {
    countAllWechatFans,
    countWechatFans,
    findSyncTask,
    findWechatFan,
    findWechatFansByUnionid,
    latestSyncTask,
    listWechatFans,
    listWechatTags,
    upsertWechatTag,
    type WechatFanRow,
    type WechatSyncTaskRow,
    type WechatTagRow,
} from './db/fanRepository'
import { fetchWechatFanPage, fetchWechatFanProfiles, fetchWechatTags } from './openapi'
import type { WechatTokenAccessDeps } from './accountToken'

/** 解析标签 JSON：平台返回异常内容时按空数组处理，不让详情页崩掉 */
function readTagIds(value: string): number[] {
    try {
        const parsed: unknown = JSON.parse(value)
        if (!Array.isArray(parsed)) {
            return []
        }
        return parsed
            .filter((item): item is number => typeof item === 'number' && Number.isInteger(item) && item > 0)
            .sort((left, right) => left - right)
    } catch {
        return []
    }
}

/** 收窄同步状态：库里的历史值异常时按失败处理，不把未知状态透给界面 */
function readSyncStatus(value: string): WechatFanSyncTask['status'] {
    return value === 'running' || value === 'success' || value === 'partial' || value === 'failed' ? value : 'failed'
}

/**
 * 显示名：平台自 2021-12-27 起不再返回真实昵称，优先用公众号后台维护的备注，最后才用 openid 前缀。
 * 备注仍由资料接口返回，是用户在后台唯一可自定义的标识，不把它与原始昵称混写进同一字段。
 */
function readFanDisplayName(nickname: string, remark: string | null | undefined, openid: string): string {
    if (nickname.length > 0) {
        return nickname
    }
    if (remark !== null && remark !== undefined && remark.length > 0) {
        return remark
    }
    return openid.slice(0, 8)
}

/** 快照行 → 界面摘要 */
function readFanSummary(row: WechatFanRow): WechatFanSummary {
    return {
        openid: row.openid,
        ...(row.unionid === null || row.unionid.length === 0 ? {} : { unionid: row.unionid }),
        nickname: readFanDisplayName(row.nickname, row.remark, row.openid),
        ...(row.avatar === null ? {} : { avatar: row.avatar }),
        subscribeStatus: row.subscribe_status,
        ...(row.subscribed_at === null ? {} : { subscribedAt: row.subscribed_at }),
        ...(row.remark === null ? {} : { remark: row.remark }),
        ...(row.subscribe_scene === null ? {} : { subscribeScene: row.subscribe_scene }),
        tagIds: readTagIds(row.tag_ids),
        isBlocked: row.is_blocked === 1,
        lastSyncedAt: row.last_synced_at,
    }
}

/** 标签行 → 界面摘要 */
function readTag(row: WechatTagRow): WechatFanTag {
    return { id: row.tag_id, name: row.name, count: row.count }
}

/** 任务行 → 界面摘要 */
function readSyncTask(row: WechatSyncTaskRow): WechatFanSyncTask {
    return {
        id: row.id,
        status: readSyncStatus(row.status),
        cursor: row.cursor,
        pageCount: row.page_count,
        fetched: row.fetched,
        total: row.total,
        createdCount: row.created_count,
        updatedCount: row.updated_count,
        unfollowed: row.unfollowed,
        failedCount: row.failed_count,
        ...(row.error_code === null ? {} : { errorCode: row.error_code }),
        ...(row.error_hint === null ? {} : { errorHint: row.error_hint }),
        startedAt: row.started_at,
        ...(row.finished_at === null ? {} : { finishedAt: row.finished_at }),
    }
}

/** 最近一次同步的展示时间：优先完成时间，运行中退回开始时间 */
function readSyncedAt(accountId: string, db: WechatTokenAccessDeps['db']): string | undefined {
    const task = latestSyncTask(db, accountId)
    return task === null ? undefined : (task.finished_at ?? task.started_at)
}

export class WechatFanService {
    public constructor(private readonly deps: WechatTokenAccessDeps) {}

    /**
     * 关注者列表：有快照读本地，无快照回落平台首屏。
     * 关键约束：回落时资料接口失败降级为「只有 openid」，openid 列表本身可用，昵称缺失只影响可读性。
     */
    public async list(request: WechatFanListRequest): Promise<WechatFanListResult> {
        const rows = listWechatFans(this.deps.db, request.accountId, { limit: WECHAT_FAN_BATCH_LIMIT })
        const task = latestSyncTask(this.deps.db, request.accountId)
        if (rows.length > 0) {
            return {
                fans: rows.map(readFanSummary),
                total: task?.total ?? countAllWechatFans(this.deps.db, request.accountId),
                ...(task === null ? {} : { syncedAt: task.finished_at ?? task.started_at }),
            }
        }

        const { accessToken } = await requireWechatToken(this.deps, request.accountId)
        const page = await fetchWechatFanPage(accessToken, request.nextOpenid)
        if (!page.ok) {
            throw new Error(page.message)
        }
        const openids = page.data.openids.slice(0, WECHAT_FAN_BATCH_LIMIT)
        if (openids.length === 0) {
            return { fans: [], total: page.data.total }
        }

        const profiles = await fetchWechatFanProfiles(accessToken, openids)
        if (!profiles.ok) {
            return {
                fans: openids.map((openid) => ({
                    openid,
                    nickname: '',
                    subscribeStatus: 1,
                    tagIds: [],
                    isBlocked: false,
                })),
                total: page.data.total,
                ...(task === null ? {} : { syncedAt: task.finished_at ?? task.started_at }),
            }
        }
        const byOpenid = new Map(profiles.data.map((profile) => [profile.openid, profile]))
        const fans: WechatFanSummary[] = openids.map((openid) => {
            const profile = byOpenid.get(openid)
            if (profile === undefined) {
                return { openid, nickname: '', subscribeStatus: 0, tagIds: [], isBlocked: false }
            }
            return {
                openid,
                nickname: readFanDisplayName(profile.nickname, profile.remark, openid),
                ...(profile.avatar === undefined ? {} : { avatar: profile.avatar }),
                subscribeStatus: profile.subscribeStatus,
                ...(profile.subscribedAt === undefined ? {} : { subscribedAt: profile.subscribedAt }),
                ...(profile.subscribeScene === undefined ? {} : { subscribeScene: profile.subscribeScene }),
                tagIds: [],
                isBlocked: false,
            }
        })
        return {
            fans,
            total: page.data.total,
            ...(task === null ? {} : { syncedAt: task.finished_at ?? task.started_at }),
        }
    }

    /** 本地快照检索：关键词、标签与关注状态叠加，不触发平台请求 */
    public search(request: WechatFanSearchRequest): WechatFanSearchResult {
        const filter = {
            ...(request.keyword === undefined ? {} : { keyword: request.keyword }),
            ...(request.tagId === undefined ? {} : { tagId: request.tagId }),
            ...(request.subscribeStatus === undefined ? {} : { subscribeStatus: request.subscribeStatus }),
            ...(request.isBlocked === undefined ? {} : { isBlocked: request.isBlocked }),
            limit: request.limit ?? WECHAT_FAN_BATCH_LIMIT,
            offset: request.offset ?? 0,
        }
        const syncedAt = readSyncedAt(request.accountId, this.deps.db)
        return {
            fans: listWechatFans(this.deps.db, request.accountId, filter).map(readFanSummary),
            total: countWechatFans(this.deps.db, request.accountId, filter),
            snapshotTotal: countAllWechatFans(this.deps.db, request.accountId),
            ...(syncedAt === undefined ? {} : { syncedAt }),
        }
    }

    /** 用户详情：快照中不存在时直接报错；跨账号关联只在 UnionID 有值时查询 */
    public detail(request: WechatFanDetailRequest): WechatFanDetailResult {
        const row = findWechatFan(this.deps.db, request.accountId, request.openid)
        if (row === null) {
            throw new Error('该用户不在本地快照中，请先同步用户数据')
        }
        const related: WechatFanRelatedAccount[] = []
        if (row.unionid !== null && row.unionid.length > 0) {
            for (const account of listWechatAccounts(this.deps.db)) {
                if (account.id === request.accountId) {
                    continue
                }
                for (const match of findWechatFansByUnionid(this.deps.db, account.id, row.unionid)) {
                    related.push({
                        accountName: account.name,
                        openid: match.openid,
                        ...(match.subscribed_at === null ? {} : { subscribedAt: match.subscribed_at }),
                    })
                }
            }
        }
        return {
            fan: readFanSummary(row),
            ...(row.country === null ? {} : { country: row.country }),
            ...(row.province === null ? {} : { province: row.province }),
            ...(row.city === null ? {} : { city: row.city }),
            ...(row.language === null ? {} : { language: row.language }),
            ...(row.subscribe_scene === null ? {} : { subscribeScene: row.subscribe_scene }),
            ...(row.qr_scene === null ? {} : { qrScene: row.qr_scene }),
            related,
        }
    }

    /** 标签列表：有本地映射读本地，空库时拉平台并写入，人数以平台统计为准 */
    public async tags(accountId: string): Promise<WechatFanTagsResult> {
        const rows = listWechatTags(this.deps.db, accountId)
        if (rows.length > 0) {
            return { tags: rows.map(readTag) }
        }
        const { accessToken } = await requireWechatToken(this.deps, accountId)
        const outcome = await fetchWechatTags(accessToken)
        if (!outcome.ok) {
            throw new Error(outcome.message)
        }
        const tags = outcome.data.map((row) => ({ id: row.id, name: row.name, count: row.count }))
        const now = new Date().toISOString()
        for (const tag of tags) {
            upsertWechatTag(this.deps.db, {
                accountId,
                tagId: tag.id,
                name: tag.name,
                count: tag.count,
                updatedAt: now,
            })
        }
        return { tags }
    }

    /** 同步任务状态：taskId 缺省时取最近一次 */
    public syncStatus(request: WechatFanSyncStatusRequest): WechatFanSyncStatusResult {
        const row =
            request.taskId === undefined
                ? latestSyncTask(this.deps.db, request.accountId)
                : findSyncTask(this.deps.db, request.accountId, request.taskId)
        return { task: row === null ? null : readSyncTask(row) }
    }
}
