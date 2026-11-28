/**
 * 信息流视图：时间线 / 热门频道 / 自建分组 / 我的赞共用一套区块，只差控制器与空态文案。
 * 复用约定：区块取同目录 WeiboFeedSection，顶部分段筛选取 components/SegmentedRail，
 * 选项与判定取 utils/weiboFeedFilter，凭证与屏蔽入口由页面注入，视图标识由页面解析。
 * 关键约束：时间线缺默认分组、分组结果未到时先给加载态，避免误报「没有内容」；
 * 空态文案固定在本文件，页面不再拼字符串；翻页一律由 feed.loadMore 承担；
 * 筛选只裁已加载列表（信息流接口没有筛选参数），hasMore 沿用原值以便继续翻页，
 * 裁空时改给「继续加载 / 查看全部」空态，未配置凭证时不渲染筛选栏；
 * 筛选栏在 AppContent 的滚动区里吸顶，必须自带底色，否则列表会从栏下与行间空隙透出；
 * 切换筛选后把滚动宿主拉回顶部，新一批内容从第一条看起。
 */
import { Inbox } from 'lucide-react'
import { useRef, useState } from 'react'
import type { WeiboCredentialState, WeiboGroupItem } from '@shared/types/weibo'
import { SCROLL_VIEWPORT_SELECTOR } from '@shared/utils/scrollArea'
import { Empty } from '@webview/blocks/Empty'
import { Button } from '@webview/components/Button'
import { SegmentedRail } from '@webview/components/SegmentedRail'
import { WeiboFeedSection } from './WeiboFeedSection'
import type { WeiboFeedController } from '../hooks/useWeiboFeed'
import type { WeiboFeedFilter } from '../utils/weiboFeedFilter'
import type { WeiboContentKind, WeiboFeedSources } from '../utils/weiboFeedRouting'
import type { JSX, ReactNode } from 'react'
import { WEIBO_FEED_FILTER_OPTIONS, filterWeiboFeedPosts, readWeiboFeedFilter } from '../utils/weiboFeedFilter'
import { WEIBO_UI_TEXT } from '../utils/weiboUiText'

/** 本组件负责的内容种类：首页与热搜页各有自己的视图，不在此列 */
export type WeiboFeedKind = Exclude<WeiboContentKind, 'home' | 'hotRank'>

export interface WeiboFeedViewsProps {
    kind: WeiboFeedKind
    feeds: WeiboFeedSources
    isConfigured: boolean
    /** 默认分组的 list_id：为空且已配置时提示重新读取分组 */
    timelineListId: string | null
    activeGroup: WeiboGroupItem | null
    credential: WeiboCredentialState | null
    credentialErrorCode: string | null
    credentialErrorMessage: string | null
    groupsLoading: boolean
    groupsErrorMessage: string | null
    onReloadGroups: () => void
    onBlockAuthor: (authorName: string) => void
    viewerUid: string | null
    onRefresh: () => void
    onOpenSettings: () => void
}

export function WeiboFeedViews({
    kind,
    feeds,
    isConfigured,
    timelineListId,
    activeGroup,
    credential,
    credentialErrorCode,
    credentialErrorMessage,
    groupsLoading,
    groupsErrorMessage,
    onReloadGroups,
    onBlockAuthor,
    viewerUid,
    onRefresh,
    onOpenSettings,
}: WeiboFeedViewsProps): JSX.Element {
    /** 筛选值：四个视图共用一份，切换视图时沿用，不必每次切 tab 重选 */
    const [filter, setFilter] = useState<WeiboFeedFilter>('all')
    /** 凭证就绪才给筛选栏：凭证门占位时筛选无对象，多一行控件只会干扰阅读 */
    const isCredentialReady = credential?.isConfigured === true
    /** 筛选栏节点：切换筛选时借它向上找到 AppContent 的滚动宿主 */
    const filterBarRef = useRef<HTMLDivElement | null>(null)

    /** 切换筛选：列表整批换掉，先把滚动宿主拉回第一屏，避免停在上一批内容的深处 */
    function handleFilterChange(next: WeiboFeedFilter): void {
        setFilter(next)
        filterBarRef.current?.closest<HTMLElement>(SCROLL_VIEWPORT_SELECTOR)?.scrollTo({ top: 0 })
    }

    /** 按筛选裁掉不匹配条目：hasMore 原样保留，筛选态下仍能继续往后翻 */
    function readFilteredFeed(feed: WeiboFeedController): WeiboFeedController {
        if (filter === 'all') {
            return feed
        }
        const posts = filterWeiboFeedPosts(feed.state.posts, filter)
        return posts === feed.state.posts ? feed : { ...feed, state: { ...feed.state, posts } }
    }

    /**
     * 裁空时的空态：只在「原始列表有内容且没有取数错误」时接管。
     * 列表为空时哨兵不渲染、自动翻页停摆，因此必须显式给出「继续加载」出口，
     * 否则用户会把「这一屏没命中」误读成「这类内容一条都没有」。
     */
    function renderFilteredEmptyState(feed: WeiboFeedController): ReactNode {
        if (filter === 'all' || feed.state.posts.length === 0 || feed.state.errorMessage !== null) {
            return undefined
        }
        return (
            <Empty
                className="py-8"
                icon={Inbox}
                title={WEIBO_UI_TEXT.empty.filtered}
                description={`已加载的 ${String(feed.state.posts.length)} 条微博里没有符合该筛选的内容。`}
            >
                <div className="flex flex-wrap items-center justify-center gap-2">
                    {feed.state.hasMore ? (
                        <Button
                            variant="outline"
                            onClick={() => {
                                void feed.loadMore()
                            }}
                        >
                            {WEIBO_UI_TEXT.action.continueLoad}
                        </Button>
                    ) : null}
                    <Button
                        variant="ghost"
                        onClick={() => {
                            setFilter('all')
                        }}
                    >
                        {WEIBO_UI_TEXT.action.viewAll}
                    </Button>
                </div>
            </Empty>
        )
    }

    /** 四个视图共用同一套区块：只差控制器与两条空态文案 */
    function renderSection(feed: WeiboFeedController, emptyTitle: string, emptyDescription: string): JSX.Element {
        const filteredFeed = readFilteredFeed(feed)
        return (
            <>
                {isCredentialReady ? (
                    // 吸顶：AppContent 是本视图的滚动容器，sticky 必须自带底色，否则列表会从栏下透出；
                    // 底色向左右各外扩 4px（负外边距 + 等量内边距）盖住卡片边框，
                    // 下方用 pb-3 配 -mb-3 顶掉父级 gap，让 12px 间隔也落在底色里而不是留一条透缝
                    <div ref={filterBarRef} className="sticky top-0 z-10 -mx-1 -mb-3 bg-background px-1 pt-1 pb-3">
                        <SegmentedRail
                            items={WEIBO_FEED_FILTER_OPTIONS}
                            value={filter}
                            onChange={(value) => {
                                handleFilterChange(readWeiboFeedFilter(value))
                            }}
                            label="信息流筛选"
                            isStretched={false}
                        />
                    </div>
                ) : null}
                <WeiboFeedSection
                    feed={filteredFeed}
                    credential={credential}
                    credentialErrorCode={credentialErrorCode}
                    credentialErrorMessage={credentialErrorMessage}
                    emptyTitle={emptyTitle}
                    emptyDescription={emptyDescription}
                    emptyState={renderFilteredEmptyState(feed)}
                    onBlockAuthor={onBlockAuthor}
                    viewerUid={viewerUid}
                    onRefresh={onRefresh}
                    onOpenSettings={onOpenSettings}
                />
            </>
        )
    }

    if (kind === 'timeline') {
        if (isConfigured && timelineListId === null) {
            if (groupsLoading) {
                return <Empty className="py-8" title={WEIBO_UI_TEXT.loading.defaultGroup} isLoading />
            }
            return (
                <Empty
                    className="py-8"
                    icon={Inbox}
                    title={WEIBO_UI_TEXT.error.group}
                    description={groupsErrorMessage ?? '默认分组决定时间线的 list_id：刷新分组后再试。'}
                >
                    <Button size="sm" variant="outline" onClick={onReloadGroups}>
                        {WEIBO_UI_TEXT.action.reloadGroups}
                    </Button>
                </Empty>
            )
        }
        return renderSection(feeds.timeline, WEIBO_UI_TEXT.empty.timeline, '默认分组近期没有更新，稍后刷新一次再试。')
    }

    if (kind === 'hotFeed') {
        return renderSection(feeds.hot, WEIBO_UI_TEXT.empty.hot, '推荐频道暂时返回空页，稍后刷新一次再试。')
    }

    if (kind === 'likes') {
        return renderSection(feeds.likes, WEIBO_UI_TEXT.empty.likes, '在微博里点过赞的内容会按时间倒序出现在这里。')
    }

    if (isConfigured && groupsLoading && activeGroup === null) {
        return <Empty className="py-8" title={WEIBO_UI_TEXT.loading.groups} isLoading />
    }
    return renderSection(
        feeds.group,
        `「${activeGroup?.title ?? '该分组'}」没有内容`,
        '分组近期没有更新，稍后刷新一次再试。',
    )
}
