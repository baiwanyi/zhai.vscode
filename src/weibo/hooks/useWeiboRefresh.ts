/**
 * 顶栏刷新：按「个人主页 → 当前信息流 → 热搜榜单 → 首页时间线」的顺序分发，并给出按钮摘要。
 * 复用约定：摘要口径沿用 utils/weiboFeedRouting 的 readRefreshSummary，滚动归零复用
 * @shared/utils/scrollArea 的 scrollAreaToTop，与切页回顶保持同一份实现。
 * 关键约束：刷新前先把滚动条拉回顶部，新内容从第一条看起；主页优先于视图内容，
 * 否则停在别人主页时顶栏刷新会去刷别的流；每个分支都显式 void，不漏未处理的 Promise。
 */
import { useCallback } from 'react'
import type { WeiboHotRankTab } from '@shared/types/weibo'
import { scrollAreaToTop } from '@shared/utils/scrollArea'
import type { WeiboView } from '../layout/weiboNavGroups'
import type { WeiboRefreshSummary, WeiboRefreshSummaryInput } from '../utils/weiboFeedRouting'
import type { WeiboUserTarget } from '../utils/weiboLinks'
import type { WeiboFeedController } from './useWeiboFeed'
import type { WeiboUserBlogController } from './useWeiboUserBlog'
import type { RefObject } from 'react'
import { readRefreshSummary } from '../utils/weiboFeedRouting'

export interface WeiboRefreshOptions {
    /** 页面根节点：滚动宿主藏在 AppContent 的 ScrollArea 里 */
    pageRef: RefObject<HTMLDivElement | null>
    view: WeiboView
    /** 页内个人主页目标：非空时刷新的是该用户的列表 */
    userTarget: WeiboUserTarget | null
    /** 当前视图的信息流：热搜页与频道页可能为 null */
    activeFeed: WeiboFeedController | null
    hotRankTab: WeiboHotRankTab | null
    hotRankState: WeiboRefreshSummaryInput['hotRankState']
    homeState: WeiboRefreshSummaryInput['homeState']
    isConfigured: boolean
    /** 个人主页控制器：摘要与刷新动作都从它读 */
    userBlog: WeiboUserBlogController
    refreshHome: () => Promise<void>
    refreshHotRank: () => Promise<void>
}

export interface WeiboRefreshController {
    /** 顶栏刷新：按当前所在页面分发到对应控制器 */
    refresh: () => void
    /** 顶栏按钮的加载态、不可用条件与内容条数 */
    summary: WeiboRefreshSummary
}

/** 刷新控制器：动作分发与摘要计算同源，页面只消费这两个字段 */
export function useWeiboRefresh({
    pageRef,
    view,
    userTarget,
    activeFeed,
    hotRankTab,
    hotRankState,
    homeState,
    isConfigured,
    userBlog,
    refreshHome,
    refreshHotRank,
}: WeiboRefreshOptions): WeiboRefreshController {
    const { refresh: refreshUserBlog } = userBlog
    const summary =
        userTarget === null
            ? readRefreshSummary({ view, activeFeed, hotRankTab, hotRankState, homeState, isConfigured })
            : {
                  isRefreshing: userBlog.state.isRefreshing,
                  isRefreshDisabled: !isConfigured,
                  contentCount: userBlog.state.posts.length,
              }

    const refresh = useCallback((): void => {
        // 刷新等于重开一屏：先把滚动条拉回顶部，新内容从第一条看起
        scrollAreaToTop(pageRef.current)
        // 个人主页优先：刷新的是该用户的列表，与顶栏按钮共用同一份状态
        if (userTarget !== null) {
            void refreshUserBlog()
            return
        }
        if (activeFeed !== null) {
            void activeFeed.refresh()
            return
        }
        // 热搜页：顶栏刷新与页面内按钮是同一个动作，直接刷当前标签的榜单
        if (hotRankTab !== null) {
            void refreshHotRank()
            return
        }
        void refreshHome()
    }, [activeFeed, hotRankTab, pageRef, refreshHome, refreshHotRank, refreshUserBlog, userTarget])

    return { refresh, summary }
}
