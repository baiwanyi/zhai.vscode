/**
 * 用户同步服务：按平台游标拉取关注者，分批补资料后覆盖本地快照，并在收尾时回读黑名单。
 * 复用约定：Token 走 accountToken，平台接口走 openapi，落库走 db/fanRepository；任务行保存游标与计数，
 * 一次调用最多处理数页后返回，界面据此显示进度并支持续跑。
 * 关键约束：user/get 单页最多 1 万个 openid、资料接口一次只收 100 个，必须严格按 100 分批，不能整页直传；
 * 额度耗尽记为 partial 且保留游标，网络失败记为 failed 也不丢进度；资料缺失时保留旧快照的可编辑字段，
 * 仅新用户写空壳记录；收尾时把本轮未出现的关注者标为已取关；黑名单每次最多 1000 个、需按 next_openid 续拉，
 * 接口失败时保留旧标记不让一次抖动清空状态。
 */
import { randomUUID } from 'node:crypto'
import {
    WECHAT_FAN_BATCH_LIMIT,
    type WechatFanSyncRequest,
    type WechatFanSyncResult,
    type WechatFanSyncTask,
} from '@shared/types/wechat'
import { requireWechatToken } from './accountToken'
import {
    findSyncTask,
    findWechatFan,
    insertSyncTask,
    syncWechatFanBlocked,
    updateSyncTask,
    upsertWechatFan,
    upsertWechatTag,
    type WechatFanRecord,
    type WechatFanRow,
    type WechatSyncTaskRow,
} from './db/fanRepository'
import {
    fetchWechatBlacklist,
    fetchWechatFanPage,
    fetchWechatFanProfiles,
    fetchWechatTags,
    type WechatFanProfile,
} from './openapi'
import type { WechatTokenAccessDeps } from './accountToken'

/** 单次调用最多处理页数：避免一次请求拉完整个大号而长时间无响应 */
const MAX_PAGES_PER_CALL = 5

/** 平台当日额度耗尽：此时任务保留为可续跑状态，而不是失败 */
const QUOTA_ERROR_CODE = 45009

/** 黑名单续拉页上限：1000/页，20 页足够覆盖普通公众号，同时防止异常游标死循环 */
const BLACKLIST_MAX_PAGES = 20

/** 任务行 → 界面摘要 */
function readTask(row: WechatSyncTaskRow): WechatFanSyncTask {
    return {
        id: row.id,
        status:
            row.status === 'success' || row.status === 'partial' || row.status === 'running' ? row.status : 'failed',
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

/** 用户资料 → 落库记录；昵称与头像允许缺省，UnionID 没有时按缺省处理 */
function profileRecord(accountId: string, profile: WechatFanProfile, syncedAt: string): WechatFanRecord {
    return {
        accountId,
        openid: profile.openid,
        unionid: profile.unionid ?? null,
        nickname:
            profile.nickname.length > 0
                ? profile.nickname
                : (profile.remark ?? '').length > 0
                  ? (profile.remark ?? '')
                  : profile.openid.slice(0, 8),
        avatar: profile.avatar ?? null,
        subscribeStatus: profile.subscribeStatus,
        subscribedAt: profile.subscribedAt ?? null,
        remark: profile.remark ?? null,
        country: profile.country ?? null,
        province: profile.province ?? null,
        city: profile.city ?? null,
        language: profile.language ?? null,
        subscribeScene: profile.subscribeScene ?? null,
        qrScene: profile.qrScene ?? null,
        tagIds: JSON.stringify(profile.tagIds),
        isBlocked: false,
        lastSyncedAt: syncedAt,
        createdAt: syncedAt,
        updatedAt: syncedAt,
    }
}

/** 全新用户的空壳记录：只保留 openid 与关注状态，不让整批失败；已有快照走 carryRecord 保留字段 */
function fallbackRecord(accountId: string, openid: string, syncedAt: string): WechatFanRecord {
    return {
        accountId,
        openid,
        unionid: null,
        nickname: openid.slice(0, 8),
        avatar: null,
        subscribeStatus: 1,
        subscribedAt: null,
        remark: null,
        country: null,
        province: null,
        city: null,
        language: null,
        subscribeScene: null,
        qrScene: null,
        tagIds: '[]',
        isBlocked: false,
        lastSyncedAt: syncedAt,
        createdAt: syncedAt,
        updatedAt: syncedAt,
    }
}

/** 资料缺失且有旧快照：只刷新同步时间与关注状态，可编辑字段与黑名单标记原样保留 */
function carryRecord(accountId: string, row: WechatFanRow, syncedAt: string): WechatFanRecord {
    return {
        accountId,
        openid: row.openid,
        unionid: row.unionid,
        nickname: row.nickname,
        avatar: row.avatar,
        subscribeStatus: 1,
        subscribedAt: row.subscribed_at,
        remark: row.remark,
        country: row.country,
        province: row.province,
        city: row.city,
        language: row.language,
        subscribeScene: row.subscribe_scene,
        qrScene: row.qr_scene,
        tagIds: row.tag_ids,
        isBlocked: row.is_blocked === 1,
        lastSyncedAt: syncedAt,
        createdAt: row.created_at,
        updatedAt: syncedAt,
    }
}

/**
 * 把一批 openid 的资料写入快照，返回资料缺失的条数。
 * 缺失资料的用户若已有快照则保留旧字段，仅新用户才写入空壳记录，避免接口抖动抹掉备注与标签。
 */
function saveBatch(
    db: WechatTokenAccessDeps['db'],
    accountId: string,
    openids: string[],
    profiles: WechatFanProfile[],
    syncedAt: string,
): number {
    const byOpenid = new Map(profiles.map((profile) => [profile.openid, profile]))
    let missing = 0
    for (const openid of openids) {
        const profile = byOpenid.get(openid)
        if (profile !== undefined) {
            upsertWechatFan(db, profileRecord(accountId, profile, syncedAt))
            continue
        }
        missing += 1
        const existing = findWechatFan(db, accountId, openid)
        upsertWechatFan(
            db,
            existing === null
                ? fallbackRecord(accountId, openid, syncedAt)
                : carryRecord(accountId, existing, syncedAt),
        )
    }
    return missing
}

export class WechatFanSyncService {
    public constructor(private readonly deps: WechatTokenAccessDeps) {}

    /** 新建或读取续跑任务：显式判空，不把仓储的空结果当成成功 */
    private loadTask(request: WechatFanSyncRequest): WechatSyncTaskRow {
        if (request.taskId !== undefined) {
            const existing = findSyncTask(this.deps.db, request.accountId, request.taskId)
            if (existing === null) {
                throw new Error('同步任务不存在或已被清理，请重新发起同步')
            }
            return existing
        }
        const id = randomUUID()
        const now = new Date().toISOString()
        insertSyncTask(this.deps.db, {
            id,
            accountId: request.accountId,
            status: 'running',
            cursor: '',
            pageCount: 0,
            fetched: 0,
            createdCount: 0,
            updatedCount: 0,
            unfollowed: 0,
            failedCount: 0,
            total: 0,
            errorCode: null,
            errorHint: null,
            startedAt: now,
            finishedAt: null,
        })
        const created = findSyncTask(this.deps.db, request.accountId, id)
        if (created === null) {
            throw new Error('同步任务创建失败，请重试')
        }
        return created
    }

    /** 覆盖任务行：每批处理完都写回，供断点续跑 */
    private writeTask(task: WechatSyncTaskRow): void {
        updateSyncTask(this.deps.db, {
            id: task.id,
            accountId: task.account_id,
            status: task.status,
            cursor: task.cursor,
            pageCount: task.page_count,
            fetched: task.fetched,
            createdCount: task.created_count,
            updatedCount: task.updated_count,
            unfollowed: task.unfollowed,
            failedCount: task.failed_count,
            total: task.total,
            errorCode: task.error_code,
            errorHint: task.error_hint,
            startedAt: task.started_at,
            finishedAt: task.finished_at,
        })
    }

    /** 收尾：把本轮未出现的关注者标为已取关，返回条数 */
    private markUnfollowed(accountId: string, startedAt: string, syncedAt: string): number {
        const result = this.deps.db
            .prepare(
                `UPDATE wechat_fans SET subscribe_status = 0, updated_at = ?
                  WHERE account_id = ? AND subscribe_status = 1 AND last_synced_at < ?`,
            )
            .run(syncedAt, accountId, startedAt)
        return result.changes
    }

    /** 全量回读黑名单并覆盖标记；接口失败时保留旧标记，不让一次抖动清空已拉黑状态 */
    private async syncBlacklist(accountId: string, accessToken: string): Promise<void> {
        const openids: string[] = []
        let begin: string | undefined
        for (let page = 0; page < BLACKLIST_MAX_PAGES; page += 1) {
            const outcome = await fetchWechatBlacklist(accessToken, begin)
            if (!outcome.ok) {
                return
            }
            openids.push(...outcome.data.openids)
            if (outcome.data.nextOpenid === undefined) {
                break
            }
            begin = outcome.data.nextOpenid
        }
        syncWechatFanBlocked(this.deps.db, accountId, openids, new Date().toISOString())
    }

    /** 触发或续跑同步；已成功的任务直接回读，不重复请求平台 */
    public async sync(request: WechatFanSyncRequest): Promise<WechatFanSyncResult> {
        const task = this.loadTask(request)
        if (task.status === 'success') {
            return { task: readTask(task) }
        }
        const { accessToken } = await requireWechatToken(this.deps, request.accountId)

        // 标签只在首轮拉一次：标签变更频率低，重复拉取会浪费接口额度
        if (task.page_count === 0) {
            const tags = await fetchWechatTags(accessToken)
            if (tags.ok) {
                const now = new Date().toISOString()
                for (const tag of tags.data) {
                    upsertWechatTag(this.deps.db, {
                        accountId: request.accountId,
                        tagId: tag.id,
                        name: tag.name,
                        count: tag.count,
                        updatedAt: now,
                    })
                }
            }
        }

        let current = task
        for (let page = 0; page < MAX_PAGES_PER_CALL; page += 1) {
            const outcome = await fetchWechatFanPage(accessToken, current.cursor)
            if (!outcome.ok) {
                const status = outcome.errorCode === QUOTA_ERROR_CODE ? 'partial' : 'failed'
                current = {
                    ...current,
                    status,
                    error_code: outcome.errorCode,
                    error_hint: outcome.message,
                    finished_at: new Date().toISOString(),
                }
                this.writeTask(current)
                return { task: readTask(current) }
            }

            const openids = outcome.data.openids
            let missing = 0
            for (let offset = 0; offset < openids.length; offset += WECHAT_FAN_BATCH_LIMIT) {
                const batch = openids.slice(offset, offset + WECHAT_FAN_BATCH_LIMIT)
                const profiles = await fetchWechatFanProfiles(accessToken, batch)
                if (profiles.ok) {
                    missing += saveBatch(
                        this.deps.db,
                        request.accountId,
                        batch,
                        profiles.data,
                        new Date().toISOString(),
                    )
                } else {
                    missing += saveBatch(this.deps.db, request.accountId, batch, [], new Date().toISOString())
                }
            }

            const isLastPage = openids.length === 0 || outcome.data.nextOpenid === undefined
            current = {
                ...current,
                status: isLastPage ? 'success' : 'running',
                cursor: isLastPage ? '' : (outcome.data.nextOpenid ?? ''),
                page_count: current.page_count + 1,
                fetched: current.fetched + openids.length,
                failed_count: current.failed_count + missing,
                total: outcome.data.total,
                error_code: null,
                error_hint: null,
            }
            if (isLastPage) {
                await this.syncBlacklist(request.accountId, accessToken)
                current = {
                    ...current,
                    unfollowed:
                        current.unfollowed +
                        this.markUnfollowed(request.accountId, task.started_at, new Date().toISOString()),
                    finished_at: new Date().toISOString(),
                }
            }
            this.writeTask(current)
            if (isLastPage) {
                break
            }
        }
        return { task: readTask(current) }
    }
}
