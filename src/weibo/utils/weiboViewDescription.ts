/**
 * 视图说明文案：把「当前视图 + 凭证 + 分组 + 频道」压成顶栏那一行说明。
 * 复用约定：视图判定走 layout/weiboNavGroups 的 read* 函数，时间格式复用 @shared/utils/format，
 * 页面只传原始数据，不在这里读状态。
 * 关键约束：一律一句话，不写接口字段（list_id / max_id）与分页实现；
 * 未配置时只说明怎么拿到 Cookie，不复述保存时刻；
 * 保存时刻只用于确认「填的是哪一次」，不得包含 Cookie 任何片段。
 */
import type { WeiboGroupItem, WeiboHotChannel } from '@shared/types/weibo'
import { formatDateTime } from '@shared/utils/format'
import type { WeiboView } from '../layout/weiboNavGroups'
import { readCustomGroupId, readHotChannelGid, readHotRankTab, readWeiboViewLabel } from '../layout/weiboNavGroups'

export interface WeiboViewDescriptionInput {
    view: WeiboView
    isConfigured: boolean
    /** 凭证保存时刻（ISO）：未配置时为 null */
    savedAt: string | null
    groups: readonly WeiboGroupItem[]
    hotChannels: readonly WeiboHotChannel[]
}

/** 保存时间展示：无效值只回「已登录」，不显示半截时间 */
function formatSavedAt(savedAt: string | null): string {
    if (savedAt === null) {
        return '已登录'
    }
    const savedAtText = formatDateTime(savedAt)
    return savedAtText === '' ? '已登录' : `已登录 · ${savedAtText}`
}

/** 顶栏说明：一句话讲清当前视图看什么，自建分组带上分组名 */
export function describeWeiboView({
    view,
    isConfigured,
    savedAt,
    groups,
    hotChannels,
}: WeiboViewDescriptionInput): string {
    if (view === 'home.recommend') {
        return isConfigured
            ? `${formatSavedAt(savedAt)} · 关注时间线`
            : '登录 weibo.com 后，粘贴任意 ajax 请求的完整 Cookie。'
    }
    if (view === 'home.timeline') {
        return '默认分组的最新微博'
    }
    if (view === 'mine.likes') {
        return '我点赞过的微博，按时间倒序'
    }
    if (readHotRankTab(view) !== null) {
        return `${readWeiboViewLabel(view, groups, hotChannels)}榜单`
    }
    if (readHotChannelGid(view) !== null) {
        return `${readWeiboViewLabel(view, groups, hotChannels)}频道的最新微博`
    }
    const activeGroupId = readCustomGroupId(view)
    const activeGroup = groups.find((group) => group.gid === activeGroupId)
    return `「${activeGroup?.title ?? '该分组'}」分组的最新微博`
}

/**
 * 凭证读取失败的展示文案：没有错误码时返回 undefined，卡片据此决定是否显示提示。
 * 关键约束：errorMessage 来自宿主、可能为空串；缺失时给固定兜底，避免卡片上出现空白提示。
 */
export function readCredentialNotice(errorCode: string | null, errorMessage: string | null): string | undefined {
    if (errorCode === null) {
        return undefined
    }
    return errorMessage === null || errorMessage.length === 0
        ? 'Cookie 可能已失效，请重新登录后粘贴新的 Cookie。'
        : errorMessage
}
