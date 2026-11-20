/**
 * 视图说明文案：把「当前视图 + 凭证 + 分组 + 频道」压成顶栏那行说明。
 * 复用约定：视图判定走 layout/weiboNavGroups 的 read* 函数，时间格式复用 @shared/utils/format，
 * 页面只传入原始数据，不再在组件闭包里读六个状态变量。
 * 关键约束：未配置时必须说明「依赖 Cookie」，不能复述已配置时的保存时刻；
 * 保存时刻只用于确认「填的是哪一次」，不得包含 Cookie 任何片段。
 */
import { WEIBO_FEED_DEFAULT_COUNT } from '@shared/types/weibo'
import type { WeiboGroupItem, WeiboHotChannel } from '@shared/types/weibo'
import { formatDateTime } from '@shared/utils/format'
import type { WeiboView } from '../layout/weiboNavGroups'
import { readCustomGroupId, readHotChannelGid, readHotRankTab, readWeiboViewLabel } from '../layout/weiboNavGroups'

export interface WeiboViewCopyInput {
    view: WeiboView
    isConfigured: boolean
    /** 凭证保存时刻（ISO）：未配置时为 null */
    savedAt: string | null
    groups: readonly WeiboGroupItem[]
    hotChannels: readonly WeiboHotChannel[]
}

/** 保存时间展示：无效值只回「已配置」，不显示半截时间 */
function formatSavedAt(savedAt: string | null): string {
    if (savedAt === null) {
        return '已配置登录 Cookie'
    }
    const savedAtText = formatDateTime(savedAt)
    return savedAtText === '' ? '已配置登录 Cookie' : `已配置登录 Cookie · ${savedAtText}`
}

/** 顶栏说明：已接入视图描述取数口径，自建分组说明所在分组，规划中的频道只说明状态 */
export function describeWeiboView({ view, isConfigured, savedAt, groups, hotChannels }: WeiboViewCopyInput): string {
    if (view === 'home.recommend') {
        return isConfigured
            ? `${formatSavedAt(savedAt)}：关注时间线只读浏览，图片与视频请打开原文查看。`
            : '关注时间线依赖网页版登录 Cookie：先登录 weibo.com，再从任意 ajax 请求的请求头复制完整 Cookie。'
    }
    if (view === 'home.timeline') {
        return '时间线：默认分组「最新微博」的 list_id，按增量刷新与游标翻页读取。'
    }
    if (view === 'mine.likes') {
        return '我的赞：按点赞时间倒序读取，只有页码分页，翻页不会重排已加载的条目。'
    }
    if (readHotRankTab(view) !== null) {
        return `热搜：${readWeiboViewLabel(view, groups, hotChannels)}，整页展示该榜单的全部条目。`
    }
    if (readHotChannelGid(view) !== null) {
        return `热门：${readWeiboViewLabel(view, groups, hotChannels)}，首屏 ${WEIBO_FEED_DEFAULT_COUNT} 条，翻页沿用上游 max_id。`
    }
    const activeGroupId = readCustomGroupId(view)
    if (activeGroupId === null) {
        return `${readWeiboViewLabel(view, groups, hotChannels)}：频道已在菜单规划中，数据接口尚未接入。`
    }
    const activeGroup = groups.find((group) => group.gid === activeGroupId)
    return `分组：${activeGroup?.title ?? '该分组'} 的信息流，翻页只在该分组内生效。`
}
