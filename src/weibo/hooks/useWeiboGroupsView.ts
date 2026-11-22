/**
 * 分组衍生值：把分组结果拆成视图层直接消费的三项（我的分组 / 频道池 / 时间线 list_id）。
 * 复用约定：数据来自 useWeiboGroups 的 state，类型取 @shared/types/weibo 的 WeiboGroupItem 与 WeiboHotChannel；
 * 三项各自 useMemo，保持引用稳定，下游菜单与取数 Hook 的依赖不会每轮重建。
 * 关键约束：分组结果未到货时统一回落空数组 / null，调用方不必再写可选链。
 */
import { useMemo } from 'react'
import type { WeiboGroupItem, WeiboHotChannel } from '@shared/types/weibo'
import type { WeiboGroupsController } from './useWeiboGroups'

export interface WeiboGroupsView {
    /** 账下自建分组：菜单直接渲染，也用于把 `group.<gid>` 还原成完整分组 */
    myGroups: readonly WeiboGroupItem[]
    /** 频道池：全部频道的「我的频道 / 频道推荐」分区，只作候选来源 */
    hotChannelPool: readonly WeiboHotChannel[]
    /** 时间线使用的 list_id：宿主按「最新微博」条目选定，缺失为 null */
    timelineListId: string | null
}

export function useWeiboGroupsView(state: WeiboGroupsController['state']): WeiboGroupsView {
    const groups = state.groups
    const myGroups = useMemo(() => groups?.myGroups ?? [], [groups])
    const hotChannelPool = useMemo(() => groups?.hotChannels ?? [], [groups])
    const timelineListId = groups?.timelineListId ?? null
    return { myGroups, hotChannelPool, timelineListId }
}
