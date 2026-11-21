/**
 * 页面取数装配：四个信息流控制器、热搜榜单与视图分派所需的派生值。
 * 复用约定：取数各走既有 hook，视图判定取 utils/weiboFeedRouting 与 layout/weiboNavGroups；
 * 本 Hook 只做组合，不持有弹窗、草稿等页面 UI 状态。
 * 关键约束：每个 feed 的 enabled 只在对应视图为真时才发请求；
 * 热搜刷新动作单独取回，供顶栏刷新使用（hook 内已 useCallback 化）。
 */
import type { WeiboBlockRules, WeiboGroupItem, WeiboHotRankTab } from '@shared/types/weibo'
import { useWeiboFeed } from './useWeiboFeed'
import { useWeiboHotRank } from './useWeiboHotRank'
import { useWeiboLikes } from './useWeiboLikes'
import type { WeiboView } from '../layout/weiboNavGroups'
import type { WeiboFeedController } from './useWeiboFeed'
import { readCustomGroupId, readHotChannelGid, readHotRankTab } from '../layout/weiboNavGroups'
import { pickActiveFeed } from '../utils/weiboFeedRouting'

export interface UseWeiboPageFeedsOptions {
    isConfigured: boolean
    view: WeiboView
    blockRules: WeiboBlockRules
    /** 默认分组的 list_id：来自分组结果，缺省为 null */
    timelineListId: string | null
    /** 账下自建分组：用来把当前 `group.<gid>` 还原成完整分组信息 */
    myGroups: readonly WeiboGroupItem[]
    /** 同城热搜城市代码：设置弹窗维护，只影响同城榜 */
    cityCode: string
}

export interface WeiboPageFeeds {
    timelineFeed: WeiboFeedController
    hotFeed: WeiboFeedController
    groupFeed: WeiboFeedController
    likesFeed: WeiboFeedController
    hotRank: ReturnType<typeof useWeiboHotRank>
    refreshHotRank: () => Promise<void>
    hotListId: string | null
    hotRankTab: WeiboHotRankTab | null
    activeGroup: WeiboGroupItem | null
    activeFeed: WeiboFeedController | null
}

export function useWeiboPageFeeds({
    isConfigured,
    view,
    blockRules,
    timelineListId,
    myGroups,
    cityCode,
}: UseWeiboPageFeedsOptions): WeiboPageFeeds {
    const timelineFeed = useWeiboFeed({
        source: 'timeline',
        listId: timelineListId,
        enabled: isConfigured && view === 'home.timeline',
        blockRules,
    })
    /** 当前热门频道的 gid：视图标识 `hot.<gid>` 还原而来，非热门频道为 null */
    const hotListId = readHotChannelGid(view)
    const hotFeed = useWeiboFeed({
        source: 'hot',
        listId: hotListId,
        enabled: isConfigured && hotListId !== null,
        blockRules,
    })
    /** 当前停留的自建分组：从视图标识还原 gid，再回分组集合取标题等信息 */
    const activeGroupId = readCustomGroupId(view)
    const activeGroup = activeGroupId === null ? null : (myGroups.find((group) => group.gid === activeGroupId) ?? null)
    const groupFeed = useWeiboFeed({
        source: 'group',
        listId: activeGroupId,
        enabled: isConfigured && activeGroupId !== null,
        blockRules,
    })
    /** 我的赞：账号菜单进入的独立视图，只有页码分页，未配置 Cookie 时不发请求 */
    const likesFeed = useWeiboLikes(isConfigured && view === 'mine.likes', blockRules)
    /** 热搜榜单：只在热搜页取数，顶栏「刷新」与专页内按钮共用这一份状态 */
    const hotRankTab = readHotRankTab(view)
    const hotRank = useWeiboHotRank({
        isEnabled: isConfigured && hotRankTab !== null,
        tab: hotRankTab ?? 'hotSearch',
        cityCode,
    })
    const refreshHotRank = hotRank.refresh
    /** 当前视图的信息流：时间线 / 我的赞 / 热门频道 / 自建分组，判定收敛到 utils */
    const activeFeed = pickActiveFeed(view, {
        timeline: timelineFeed,
        hot: hotFeed,
        group: groupFeed,
        likes: likesFeed,
    })

    return {
        timelineFeed,
        hotFeed,
        groupFeed,
        likesFeed,
        hotRank,
        refreshHotRank,
        hotListId,
        hotRankTab,
        activeGroup,
        activeFeed,
    }
}
