/**
 * 视图路由纯函数：按视图标识挑出当前信息流，并收敛顶栏刷新态与内容条数。
 * 复用约定：视图判定统一走 layout/weiboNavGroups 的 read* 函数，本文件不引 React；
 * 页面只消费 pickActiveFeed 与 readRefreshSummary，不再写三层嵌套三元。
 * 关键约束：热搜页没有信息流控制器（走榜单），此时 activeFeed 为 null；
 * 刷新不可用只由「未配置」与「既无信息流又无榜单」决定，规划中的频道不得落回首页数据。
 */
import type { WeiboHotRankTab } from '@shared/types/weibo'
import type { WeiboFeedController } from '../hooks/useWeiboFeed'
import type { WeiboView } from '../layout/weiboNavGroups'
import { HOME_RECOMMEND_VIEW, readCustomGroupId, readHotChannelGid } from '../layout/weiboNavGroups'

export interface WeiboFeedSources {
    timeline: WeiboFeedController
    hot: WeiboFeedController
    group: WeiboFeedController
    likes: WeiboFeedController
}

/** 当前视图对应的信息流：时间线 / 我的赞 / 热门频道 / 自建分组，其余为 null */
export function pickActiveFeed(view: WeiboView, sources: WeiboFeedSources): WeiboFeedController | null {
    if (view === 'home.timeline') {
        return sources.timeline
    }
    if (view === 'mine.likes') {
        return sources.likes
    }
    if (readHotChannelGid(view) !== null) {
        return sources.hot
    }
    if (readCustomGroupId(view) !== null) {
        return sources.group
    }
    return null
}

/** 刷新摘要入参：只取用到的字段，避免本文件依赖各控制器的完整状态类型 */
export interface WeiboRefreshSummaryInput {
    view: WeiboView
    activeFeed: WeiboFeedController | null
    hotRankTab: WeiboHotRankTab | null
    hotRankState: { isLoading: boolean; items: readonly unknown[] }
    homeState: { isRefreshing: boolean; posts: readonly unknown[] }
    isConfigured: boolean
}

export interface WeiboRefreshSummary {
    /** 顶栏刷新按钮的加载态 */
    isRefreshing: boolean
    /** 刷新不可用：未配置，或停在没有信息流也没有榜单的频道 */
    isRefreshDisabled: boolean
    /** 当前视图的内容条数：为 0 时不显示顶栏刷新 */
    contentCount: number
}

/** 顶栏刷新摘要：信息流优先，其次热搜榜单，最后回落到首页时间线 */
export function readRefreshSummary({
    view,
    activeFeed,
    hotRankTab,
    hotRankState,
    homeState,
    isConfigured,
}: WeiboRefreshSummaryInput): WeiboRefreshSummary {
    if (activeFeed !== null) {
        return {
            isRefreshing: activeFeed.state.isRefreshing,
            isRefreshDisabled: !isConfigured,
            contentCount: activeFeed.state.posts.length,
        }
    }
    if (hotRankTab !== null) {
        return {
            isRefreshing: hotRankState.isLoading,
            isRefreshDisabled: !isConfigured,
            contentCount: hotRankState.items.length,
        }
    }
    return {
        isRefreshing: homeState.isRefreshing,
        isRefreshDisabled: !isConfigured || view !== HOME_RECOMMEND_VIEW,
        contentCount: homeState.posts.length,
    }
}

/** 当前视图应渲染的内容种类：首页 / 时间线 / 我的赞 / 热搜 / 热门频道 / 自建分组 */
export type WeiboContentKind = 'home' | 'timeline' | 'likes' | 'hotRank' | 'hotFeed' | 'groupFeed'

/**
 * 内容分派：热搜优先于热门频道（专页自带整页榜单），其余按视图标识回落。
 * 关键约束：分组结果未到时 activeGroup 为 null，本函数仍归 groupFeed，由视图自己给加载态。
 */
export function resolveContentKind(
    view: WeiboView,
    hotRankTab: WeiboHotRankTab | null,
    hotListId: string | null,
): WeiboContentKind {
    if (view === HOME_RECOMMEND_VIEW) {
        return 'home'
    }
    if (view === 'home.timeline') {
        return 'timeline'
    }
    if (view === 'mine.likes') {
        return 'likes'
    }
    if (hotRankTab !== null) {
        return 'hotRank'
    }
    if (hotListId !== null) {
        return 'hotFeed'
    }
    return 'groupFeed'
}
