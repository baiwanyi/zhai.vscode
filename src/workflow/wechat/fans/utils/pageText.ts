/**
 * 页头描述文案：把账号名、分段与同步状态拼成单行说明。
 * 复用约定：纯函数，只依赖共享类型与 formatRelativeTime，与 hook 的返回结构解耦，仅接收所需字段；
 * 相对时间空串兜底复用与 fanText 一致的写法。
 * 关键约束：标签段只报标签数；快照态的平台总数取同步任务而非筛选命中数，无任务时明示未知；
 * 实时态明示只显示首屏，不把首屏数量冒充平台总数。
 */
import type { WechatFanSummary, WechatFanSyncTask, WechatFanTag } from '@shared/types/wechat'
import { formatRelativeTime } from '@shared/utils/format'
import type { FansTab } from '../types'

/** 页头描述所需的最小状态集合，避免绑定 useWechatFans 的完整返回类型 */
export interface FansDescriptionInput {
    tags: WechatFanTag[]
    isSnapshot: boolean
    syncedAt: string | null
    total: number
    snapshotTotal: number
    fans: WechatFanSummary[]
    syncTask: WechatFanSyncTask | null
}

/** 账号名 + 分段 + 状态 → 页头描述 */
export function readPageDescription(
    accountName: string,
    tab: FansTab,
    state: FansDescriptionInput,
): string {
    if (tab === 'tags') {
        return `${accountName} · ${String(state.tags.length)} 个标签`
    }
    if (state.isSnapshot) {
        const relative = state.syncedAt === null ? '' : formatRelativeTime(state.syncedAt)
        const suffix = relative.length === 0 ? '' : ` · 同步于 ${relative}`
        const platform = state.syncTask === null ? '平台总数未知' : `平台 ${String(state.syncTask.total)}`
        return `${accountName} · ${platform} / 已同步 ${String(state.snapshotTotal)}${suffix}`
    }
    return `${accountName} · 共 ${String(state.total)} 位，显示前 ${String(state.fans.length)} 位（实时）`
}
