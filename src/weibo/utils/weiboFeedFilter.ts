/**
 * 信息流筛选：在已加载的微博列表上按「原创 / 图片 / 视频 / 文本」判定与统计。
 * 复用约定：纯函数、无副作用；选项按 SegmentedRailItem 契约给出，回传值经 readWeiboFeedFilter 收窄。
 * 关键约束：微博信息流接口没有筛选参数，这里只覆盖已加载内容，界面不得把结果当成全量；
 * 图片 / 视频只按主贴 media 判定，文本还要连带要求转发体不带图片与视频（卡片会把转发体一并渲染），
 * 三者互斥且完备；原创只按「有无转发」判定、不叠加媒体条件；
 * 未发生剔除时返回原数组引用，避免上层缓存失效。
 */
import type { WeiboTimelineMedia, WeiboTimelinePost } from '@shared/types/weibo'
import type { SegmentedRailItem } from '@webview/components/SegmentedRail'

/** 筛选取值：全部 / 原创 / 图片 / 视频 / 文本 */
export type WeiboFeedFilter = 'all' | 'original' | 'image' | 'video' | 'text'

/** 分段选项：固定配置提到模块级，避免每次渲染重建数组 */
export const WEIBO_FEED_FILTER_OPTIONS: readonly SegmentedRailItem<WeiboFeedFilter>[] = [
    { value: 'all', label: '全部' },
    { value: 'original', label: '原创' },
    { value: 'image', label: '图片' },
    { value: 'video', label: '视频' },
    { value: 'text', label: '文本' },
]

/** 收窄分段回传值：SegmentedRail 回传的是普通字符串，越界一律回落到「全部」 */
export function readWeiboFeedFilter(value: string): WeiboFeedFilter {
    const matched = WEIBO_FEED_FILTER_OPTIONS.find((item) => item.value === value)
    return matched?.value ?? 'all'
}

/** 单条帖子的媒体数量口径 */
interface WeiboMediaCounts {
    images: number
    videos: number
}

/**
 * 媒体数量：上游声明的计数优先，直链与混排项作为回退，
 * 避免上游只给计数（无直链）或只给直链（计数缺失）时把图文 / 视频判成纯文本。
 */
function readMediaCounts(media: WeiboTimelineMedia): WeiboMediaCounts {
    const videoItems = media.items.reduce((count, item) => (item.kind === 'video' ? count + 1 : count), 0)
    return {
        images: Math.max(media.imageCount, media.images.length),
        videos: Math.max(media.videoCount, videoItems),
    }
}

/** 单条是否命中筛选：原创只看转发字段，图片 / 视频按主贴判定，文本还要求转发体不带媒体 */
export function matchWeiboFeedFilter(post: WeiboTimelinePost, filter: WeiboFeedFilter): boolean {
    if (filter === 'all') {
        return true
    }
    if (filter === 'original') {
        return post.retweeted === null
    }
    const own = readMediaCounts(post.media)
    if (filter === 'video') {
        return own.videos > 0
    }
    // 图片与视频并存时归入视频：视频项允许带图，图片项要求「只有图片」
    if (filter === 'image') {
        return own.images > 0 && own.videos === 0
    }
    // 文本：主贴与转发体都不能有图片或视频——卡片会把转发体的配图与视频一并渲染出来
    if (own.images > 0 || own.videos > 0) {
        return false
    }
    if (post.retweeted === null) {
        return true
    }
    const quoted = readMediaCounts(post.retweeted.media)
    return quoted.images === 0 && quoted.videos === 0
}

/** 过滤列表：没有条目被剔除时返回原引用，列表容器不会因无关的筛选切换整体重渲染 */
export function filterWeiboFeedPosts(posts: WeiboTimelinePost[], filter: WeiboFeedFilter): WeiboTimelinePost[] {
    if (filter === 'all') {
        return posts
    }
    const filtered = posts.filter((post) => matchWeiboFeedFilter(post, filter))
    return filtered.length === posts.length ? posts : filtered
}
