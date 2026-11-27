/**
 * 用户写操作服务：标签增删改、批量打标与取消、备注、黑名单。
 * 复用约定：Token 走 accountToken，平台写接口走 openapi，本地快照走 db/fanRepository；
 * 所有错误码统一经 describeFanError 归一为中文可执行提示，不把英文 errmsg 透给界面。
 * 关键约束：写成功后只更新本次涉及的快照字段，不重写整份快照；平台是唯一真相，
 * 标签删除后用户 tag_ids 里可能残留旧 id，留待下次同步按平台 tagids 覆盖，不做本地猜算；
 * 拉黑/解除不改动关注状态，避免把「拉黑」误判成「取关」；写成功只更新本次涉及的黑名单位，
 * 全量状态由同步流程的 getBlacklist 回读校正。
 */
import type {
    WechatFanBlacklistRequest,
    WechatFanBlacklistResult,
    WechatFanRemarkRequest,
    WechatFanRemarkResult,
    WechatFanTag,
    WechatFanTagCreateRequest,
    WechatFanTagMembersRequest,
    WechatFanTagMembersResult,
    WechatFanTagMutationResult,
    WechatFanTagRemoveRequest,
    WechatFanTagRemoveResult,
    WechatFanTagRenameRequest,
} from '@shared/types/wechat'
import { requireWechatToken } from './accountToken'
import {
    deleteWechatTag,
    findWechatFan,
    listWechatTags,
    updateWechatFanBlocked,
    updateWechatFanRemark,
    updateWechatFanTagIds,
    upsertWechatTag,
} from './db/fanRepository'
import {
    changeWechatBlacklist,
    changeWechatTagMembers,
    createWechatTag,
    deleteWechatTag as deletePlatformTag,
    describeFanError,
    updateWechatRemark,
    updateWechatTag as renamePlatformTag,
} from './openapi'
import type { WechatTokenAccessDeps } from './accountToken'

/** 解析快照里的标签 JSON：异常内容按空数组处理 */
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

export class WechatFanWriteService {
    public constructor(private readonly deps: WechatTokenAccessDeps) {}

    /** 新建标签：平台返回 id 后写入本地标签表 */
    public async createTag(request: WechatFanTagCreateRequest): Promise<WechatFanTagMutationResult> {
        const { accessToken } = await requireWechatToken(this.deps, request.accountId)
        const outcome = await createWechatTag(accessToken, request.name.trim())
        if (!outcome.ok || outcome.data.id <= 0) {
            throw new Error(describeFanError(outcome.ok ? -1 : outcome.errorCode))
        }
        const tag: WechatFanTag = { id: outcome.data.id, name: outcome.data.name, count: 0 }
        upsertWechatTag(this.deps.db, {
            accountId: request.accountId,
            tagId: tag.id,
            name: tag.name,
            count: 0,
            updatedAt: new Date().toISOString(),
        })
        return { tag }
    }

    /** 重命名标签：人数沿用本地已知值，下次同步以平台 count 覆盖 */
    public async renameTag(request: WechatFanTagRenameRequest): Promise<WechatFanTagMutationResult> {
        const { accessToken } = await requireWechatToken(this.deps, request.accountId)
        const outcome = await renamePlatformTag(accessToken, request.id, request.name.trim())
        if (!outcome.ok) {
            throw new Error(describeFanError(outcome.errorCode))
        }
        const existing = listWechatTags(this.deps.db, request.accountId).find((row) => row.tag_id === request.id)
        const tag: WechatFanTag = {
            id: request.id,
            name: request.name.trim(),
            count: existing?.count ?? 0,
        }
        upsertWechatTag(this.deps.db, {
            accountId: request.accountId,
            tagId: tag.id,
            name: tag.name,
            count: tag.count,
            updatedAt: new Date().toISOString(),
        })
        return { tag }
    }

    /** 删除标签：平台成功后清本地映射 */
    public async removeTag(request: WechatFanTagRemoveRequest): Promise<WechatFanTagRemoveResult> {
        const { accessToken } = await requireWechatToken(this.deps, request.accountId)
        const outcome = await deletePlatformTag(accessToken, request.id)
        if (!outcome.ok) {
            throw new Error(describeFanError(outcome.errorCode))
        }
        deleteWechatTag(this.deps.db, request.accountId, request.id)
        return { removed: true }
    }

    /** 批量打标或取消：只在平台成功后更新本地快照中的 tag_ids */
    public async tagMembers(request: WechatFanTagMembersRequest): Promise<WechatFanTagMembersResult> {
        const { accessToken } = await requireWechatToken(this.deps, request.accountId)
        const outcome = await changeWechatTagMembers(accessToken, request.openids, request.tagId, request.action)
        if (!outcome.ok) {
            throw new Error(describeFanError(outcome.errorCode))
        }
        const now = new Date().toISOString()
        let succeeded = 0
        for (const openid of request.openids) {
            const row = findWechatFan(this.deps.db, request.accountId, openid)
            if (row === null) {
                continue
            }
            const ids = readTagIds(row.tag_ids)
            const next =
                request.action === 'add'
                    ? [...new Set([...ids, request.tagId])].sort((left, right) => left - right)
                    : ids.filter((id) => id !== request.tagId)
            updateWechatFanTagIds(this.deps.db, request.accountId, openid, JSON.stringify(next), now)
            succeeded += 1
        }
        return { succeeded, failed: request.openids.length - succeeded }
    }

    /** 修改备注：空串清除 */
    public async remark(request: WechatFanRemarkRequest): Promise<WechatFanRemarkResult> {
        const { accessToken } = await requireWechatToken(this.deps, request.accountId)
        const outcome = await updateWechatRemark(accessToken, request.openid, request.remark)
        if (!outcome.ok) {
            throw new Error(describeFanError(outcome.errorCode))
        }
        updateWechatFanRemark(this.deps.db, request.accountId, request.openid, request.remark, new Date().toISOString())
        return { updated: true }
    }

    /** 拉黑或解除：不改写关注状态，只更新黑名单位；全量状态由同步时的 getBlacklist 回读校正 */
    public async blacklist(request: WechatFanBlacklistRequest): Promise<WechatFanBlacklistResult> {
        const { accessToken } = await requireWechatToken(this.deps, request.accountId)
        const outcome = await changeWechatBlacklist(accessToken, request.openids, request.action)
        if (!outcome.ok) {
            throw new Error(describeFanError(outcome.errorCode))
        }
        updateWechatFanBlocked(
            this.deps.db,
            request.accountId,
            request.openids,
            request.action === 'block',
            new Date().toISOString(),
        )
        return { succeeded: request.openids.length, failed: 0 }
    }
}
