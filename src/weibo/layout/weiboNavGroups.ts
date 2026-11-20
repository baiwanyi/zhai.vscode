/**
 * 微博顶部菜单的分组数据与视图枚举：菜单组件与页面共用这一份，避免中文名两处维护。
 * 复用约定：固定频道用 `分组.子项`，账号自建分组用 `group.<gid>`，热门频道用 `hot.<gid>`；
 * readWeiboViewLabel 是唯一的「标识 → 中文名」出口，菜单渲染与页面说明都走它；
 * readHotRankTab 把热搜页视图映射成宿主榜单来源，页面据此决定请求哪个端点。
 * 关键约束：本文件只放数据与纯函数，不导出组件 —— 组件与常量混在同一文件会破坏 Fast Refresh；
 * 自建分组与热门频道都是运行时数据（分组结果给出），不进静态清单，由菜单在对应标记处追加。
 */
import { Flame, House, TrendingUp } from 'lucide-react'
import type { WeiboGroupItem, WeiboHotChannel, WeiboHotRankTab } from '@shared/types/weibo'
import type { LucideIcon } from 'lucide-react'

/** 账号自建分组的标识前缀：后面直接拼 gid */
export const CUSTOM_GROUP_VIEW_PREFIX = 'group.'

/** 热门频道的标识前缀：后面直接拼频道 gid */
export const HOT_CHANNEL_VIEW_PREFIX = 'hot.'

/** 频道标识：`分组.子项` 为固定频道，`group.<gid>` / `hot.<gid>` 为运行时数据 */
export type WeiboView =
    | 'home.recommend'
    | 'home.timeline'
    | 'search.mine'
    | 'search.hot'
    | 'search.ent'
    | 'search.social'
    | 'search.tech'
    | 'search.life'
    | 'search.sports'
    | 'search.acg'
    | 'search.local'
    | `group.${string}`
    | `hot.${string}`

export interface WeiboNavItem {
    view: WeiboView
    label: string
}

export interface WeiboNavGroup {
    /** 分组键：菜单内部标识，须唯一 */
    id: string
    label: string
    /** 一级入口图标：lucide 组件，尺寸由菜单渲染时给定 */
    icon: LucideIcon
    items: readonly WeiboNavItem[]
    /** 该组二级末尾追加账号自建分组（首页）：分组是运行时数据，由菜单从外部传入 */
    hasCustomGroups?: boolean
    /** 该组二级全部来自热门频道表（热门）：频道清单同样由外部传入 */
    hasHotChannels?: boolean
}

/** 频道规划：顺序即菜单顺序，子项顺序即阅读顺序 */
export const WEIBO_NAV_GROUPS: readonly WeiboNavGroup[] = [
    {
        id: 'home',
        label: '首页',
        icon: House,
        items: [
            { view: 'home.recommend', label: '推荐' },
            { view: 'home.timeline', label: '时间线' },
        ],
        hasCustomGroups: true,
    },
    {
        id: 'hot',
        label: '热门',
        icon: Flame,
        // 子项完全由 allGroups 的「我的频道 / 频道推荐」决定，这里不写死任何频道
        items: [],
        hasHotChannels: true,
    },
    {
        id: 'search',
        label: '热搜',
        icon: TrendingUp,
        items: [
            { view: 'search.mine', label: '我的' },
            { view: 'search.hot', label: '热搜' },
            { view: 'search.ent', label: '文娱' },
            { view: 'search.social', label: '社会' },
            { view: 'search.tech', label: '科技' },
            { view: 'search.life', label: '生活' },
            { view: 'search.sports', label: '体育' },
            { view: 'search.acg', label: 'ACG' },
            { view: 'search.local', label: '同城' },
        ],
    },
]

/** 自建分组的视图标识：菜单与页面都按同一规则拼 */
export function toCustomGroupView(gid: string): WeiboView {
    return `${CUSTOM_GROUP_VIEW_PREFIX}${gid}`
}

/** 从视图标识里取回自建分组的 gid：不是分组频道时返回 null */
export function readCustomGroupId(view: WeiboView): string | null {
    return view.startsWith(CUSTOM_GROUP_VIEW_PREFIX) ? view.slice(CUSTOM_GROUP_VIEW_PREFIX.length) : null
}

/** 热门频道的视图标识：gid 来自 allGroups，菜单与页面按同一规则拼 */
export function toHotChannelView(gid: string): WeiboView {
    return `${HOT_CHANNEL_VIEW_PREFIX}${gid}`
}

/** 从视图标识里取回热门频道 gid：不是热门频道时返回 null */
export function readHotChannelGid(view: WeiboView): string | null {
    return view.startsWith(HOT_CHANNEL_VIEW_PREFIX) ? view.slice(HOT_CHANNEL_VIEW_PREFIX.length) : null
}

/**
 * 热搜视图 → 宿主榜单来源：热搜页每个二级频道对应一个 ajax 端点。
 * 关键约束：只收热搜页的视图，首页、热门频道与自建分组一律不在此表内。
 */
const HOT_RANK_TAB_BY_VIEW: Partial<Readonly<Record<WeiboView, WeiboHotRankTab>>> = {
    'search.mine': 'mine',
    'search.hot': 'hotSearch',
    'search.ent': 'entertainment',
    'search.social': 'social',
    'search.tech': 'technology',
    'search.life': 'life',
    'search.sports': 'sport',
    'search.acg': 'acg',
    'search.local': 'city',
}

/** 取热搜榜单来源：不是热搜频道时返回 null，调用方据此决定是否渲染热搜页 */
export function readHotRankTab(view: WeiboView): WeiboHotRankTab | null {
    return HOT_RANK_TAB_BY_VIEW[view] ?? null
}

/**
 * 取子项标签名（不含分组前缀）：页面标题只要「我的」「文娱」这样的短名。
 * 关键约束：只查静态菜单，自建分组与热门频道属于运行时数据，标题由各自的数据源给出。
 */
export function readWeiboViewItemLabel(view: WeiboView): string {
    for (const group of WEIBO_NAV_GROUPS) {
        const item = group.items.find((candidate) => candidate.view === view)
        if (item !== undefined) {
            return item.label
        }
    }
    return ''
}

/**
 * 取频道全名（分组 · 子项）：页面说明与占位标题用，未收录时回落空串。
 * 自建分组与热门频道的名字来自运行时数据，故需要把两份集合一并传入。
 */
export function readWeiboViewLabel(
    view: WeiboView,
    groups: readonly WeiboGroupItem[],
    hotChannels: readonly WeiboHotChannel[],
): string {
    const gid = readCustomGroupId(view)
    if (gid !== null) {
        const matched = groups.find((group) => group.gid === gid)
        return matched === undefined ? '分组' : `首页 · ${matched.title}`
    }
    const hotGid = readHotChannelGid(view)
    if (hotGid !== null) {
        const matched = hotChannels.find((channel) => channel.gid === hotGid)
        return matched === undefined ? '热门' : `热门 · ${matched.title}`
    }
    for (const group of WEIBO_NAV_GROUPS) {
        const item = group.items.find((candidate) => candidate.view === view)
        if (item !== undefined) {
            return `${group.label} · ${item.label}`
        }
    }
    return ''
}
