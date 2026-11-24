/**
 * 微博页：编辑区独立页，顶部菜单切换首页 / 时间线 / 热门 / 热搜与账号自建分组，
 * 顶栏动作区只剩「刷新」与账号菜单（头像 + 个人主页 / 我的赞 / 设置弹窗 / 删除 Cookie）。
 * 复用约定：页面骨架取 @webview/components/AppPage，取数装配走 useWeiboPageFeeds，
 * 视图导航 / 顶栏刷新 / 分组衍生值分别走 useWeiboPageNav / useWeiboRefresh / useWeiboGroupsView，
 * 凭证删除走 useCredentialRemoval，草稿与已选图片走 useWeiboComposerDraft，
 * 页内个人主页的目标与取数走 WeiboUserPageProvider + useWeiboUserBlog；
 * 视图组件交给 layout（WeiboHomeView / WeiboFeedViews / HotSearchView / UserBlogView / HotRankAside / WeiboNav），
 * 视图判定与文案交给 utils（weiboFeedRouting / weiboViewDescription），本文件只做装配，
 * 内容分发（主页优先 / 首页 / 热搜专页 / 信息流）由同文件的 WeiboContentView 承担。
 * 关键约束：未配置 Cookie 时任何信息流都不发请求，只给可执行的获取步骤；
 * 凭证探测未结束或失败时不得断言「没有配置」，由 CredentialGate / CredentialCard 给加载与失败态；
 * 顶栏「刷新」按当前视图分发：信息流刷自己的游标，热搜刷当前标签的榜单，个人主页刷该用户的列表；
 * 个人主页优先于视图内容：/u/ 与 /n/ 链接经 WeiboUserPageProvider 交回本页打开，切页与删 Cookie 都清空该目标；
 * 信息流滚动超过一小段后，视口底部的内容列右缘外侧出现「回到顶部」按钮（ScrollTopButton，
 * 用一套与内容区同构的占位定位，不挤压列表），点击与切页 / 刷新共用同一个 scrollAreaToTop 归零；
 * 热搜专页不再渲染右侧热搜卡，避免同一份榜单出现两次；
 * Cookie 明文只存在于输入瞬间，删除只有一个确认入口且提交中禁用；
 * 发布草稿与已选图片由页面层持有，切到其它视图再回首页仍在。
 */
import { cn } from 'cn'
import { ArrowUp, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { WeiboUserInfo } from '@shared/types/weibo'
import { scrollAreaToTop } from '@shared/utils/scrollArea'
import { AlertDialog } from '@webview/components/AlertDialog'
import {
    AppAction,
    AppContent,
    AppDescription,
    AppHeader,
    AppMenu,
    AppPage,
    AppTitle,
} from '@webview/components/AppPage'
import { AppToaster } from '@webview/components/AppToaster'
import { Button } from '@webview/components/Button'
import { useHostToast } from '@webview/hooks/useHostToast'
import { useScrollTopVisibility } from '@webview/hooks/useScrollTopVisibility'
import { WeiboUserPageProvider } from './context/WeiboUserPageProvider'
import { useCredentialRemoval } from './hooks/useCredentialRemoval'
import { useWeiboBlockList } from './hooks/useWeiboBlockList'
import { useWeiboCity } from './hooks/useWeiboCity'
import { useWeiboComposerDraft } from './hooks/useWeiboComposerDraft'
import { useWeiboGroups } from './hooks/useWeiboGroups'
import { useWeiboGroupsView } from './hooks/useWeiboGroupsView'
import { useWeiboHotChannelMenu } from './hooks/useWeiboHotChannelMenu'
import { useWeiboPageFeeds } from './hooks/useWeiboPageFeeds'
import { useWeiboPageNav } from './hooks/useWeiboPageNav'
import { useWeiboProfile } from './hooks/useWeiboProfile'
import { useWeiboRefresh } from './hooks/useWeiboRefresh'
import { useWeiboTimeline } from './hooks/useWeiboTimeline'
import { useWeiboUserBlog } from './hooks/useWeiboUserBlog'
import { HotRankAside } from './layout/HotRankAside'
import { HotSearchView } from './layout/HotSearchView'
import { SettingsDialog } from './layout/SettingsDialog'
import { UserBlogView } from './layout/UserBlogView'
import { WeiboAccountMenu } from './layout/WeiboAccountMenu'
import { WeiboFeedViews } from './layout/WeiboFeedViews'
import { WeiboHomeView } from './layout/WeiboHomeView'
import { WeiboNav } from './layout/WeiboNav'
import { resolveContentKind } from './utils/weiboFeedRouting'
import { describeWeiboView } from './utils/weiboViewDescription'
import type { WeiboComposerDraft } from './hooks/useWeiboComposerDraft'
import type { WeiboGroupsController } from './hooks/useWeiboGroups'
import type { WeiboPageFeeds } from './hooks/useWeiboPageFeeds'
import type { WeiboTimelineController } from './hooks/useWeiboTimeline'
import type { WeiboUserBlogController } from './hooks/useWeiboUserBlog'
import type { WeiboView } from './layout/weiboNavGroups'
import type { WeiboContentKind } from './utils/weiboFeedRouting'
import type { WeiboUserTarget } from './utils/weiboLinks'
import type { JSX } from 'react'

/** 回到顶部按钮的出现阈值：滚过一小段就出现，比 Hook 默认的 240 更早 */
const SCROLL_TOP_THRESHOLD = 120

/** 内容列宽度：热搜专页没有侧栏，放宽一档，长标题不必挤在 672px 里 */
type ContentWidthClass = 'max-w-2xl' | 'max-w-3xl'

interface ScrollTopButtonProps {
    /** 是否显示：滚动超过一小段才出现 */
    isVisible: boolean
    /** 内容列宽度类：与主内容区共用同一份，按钮据此算出内容列右缘 */
    contentWidthClass: ContentWidthClass
    /** 右侧是否有热搜侧栏：决定占位列，没有侧栏时按钮不会落到侧栏的位置 */
    hasAside: boolean
    onScrollToTop: () => void
}

/**
 * 回到顶部：钉在视口底部。
 * 关键约束：fixed 只相对视口定位，这里复制一套与内容区同构的宽度约束
 * （max-w-5xl → gap-3 → 内容列 max-w-* → 侧栏 w-80），把按钮绝对定位到内容列右缘外侧，
 * 既不挤压时间流、也不随内容滚走；整层 pointer-events-none，只有按钮接点击，不挡下方列表。
 */
function ScrollTopButton({
    isVisible,
    contentWidthClass,
    hasAside,
    onScrollToTop,
}: ScrollTopButtonProps): JSX.Element | null {
    if (!isVisible) {
        return null
    }
    return (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-10 px-3">
            <div className="mx-auto flex w-full max-w-5xl justify-center gap-3">
                <div className={cn('relative min-w-0 flex-1', contentWidthClass)}>
                    <div className="pointer-events-auto absolute -right-12 bottom-0">
                        <Button
                            size="icon"
                            variant="outline"
                            className="size-12"
                            tooltip="回到顶部"
                            aria-label="回到顶部"
                            onClick={onScrollToTop}
                        >
                            <ArrowUp className="size-6" aria-hidden="true" />
                        </Button>
                    </div>
                </div>
                {hasAside ? <div aria-hidden className="hidden w-80 shrink-0 @3xl:block" /> : null}
            </div>
        </div>
    )
}

/** 主页状态的顶栏说明：未配置时不假装「正在读取」，昵称缺失时用「该用户」兜底 */
function describeUserPage(isConfigured: boolean, user: WeiboUserInfo | null): string {
    if (!isConfigured) {
        return '个人主页 · 未配置 Cookie'
    }
    if (user === null) {
        return '个人主页 · 正在读取…'
    }
    return `个人主页 · ${user.name.trim().length > 0 ? user.name : '该用户'}`
}

interface WeiboContentViewProps {
    /** 是否已配置 Cookie：未配置时各视图只给获取引导 */
    isConfigured: boolean
    /** 当前视图该渲染哪块内容：首页 / 时间线 / 我的赞 / 热搜 / 热门频道 / 自建分组 */
    contentKind: WeiboContentKind
    /** 当前视图：热搜专页按它还原榜单标签 */
    view: WeiboView
    /** 页内个人主页目标：非空时整块换成该用户的主页 */
    userTarget: WeiboUserTarget | null
    userBlog: WeiboUserBlogController
    homeState: WeiboTimelineController['state']
    /** 四个信息流与热搜榜单：内容区按 contentKind 取用其中一份 */
    feeds: WeiboPageFeeds
    /** 同城热搜城市代码：只影响热搜专页的同城榜 */
    cityCode: string
    /** 发布框草稿与已选图片：首页发布卡片共用这一份 */
    composer: WeiboComposerDraft
    /** 时间线使用的 list_id：分组页据此提示未选中分组 */
    timelineListId: string | null
    /** 分组状态：只往下传加载态与错误文案 */
    groupsState: WeiboGroupsController['state']
    /** 当前登录账号 uid：主页与评论区据此判本人 */
    profileUid: string | null
    onBack: () => void
    onBlockAuthor: (authorName: string) => void
    onRefresh: () => void
    onOpenSettings: () => void
    onLoadMore: () => void
    onReloadGroups: () => void
    onSaveCredential: (cookie: string) => Promise<boolean>
}

/**
 * 内容分发：个人主页优先于视图内容，其次首页、热搜专页，其余按信息流种类渲染。
 * 关键约束：主页用 `kind:value` 作 key 重挂载，关注态、备注与分组草稿随目标整块重置；
 * 本组件只做分发与传参，不持有状态、不发请求、不拼协议字段。
 */
function WeiboContentView({
    isConfigured,
    contentKind,
    view,
    userTarget,
    userBlog,
    homeState,
    feeds,
    cityCode,
    composer,
    timelineListId,
    groupsState,
    profileUid,
    onBack,
    onBlockAuthor,
    onRefresh,
    onOpenSettings,
    onLoadMore,
    onReloadGroups,
    onSaveCredential,
}: WeiboContentViewProps): JSX.Element {
    const { timelineFeed, hotFeed, groupFeed, likesFeed, activeGroup, hotRank } = feeds
    /** 信息流集合：WeiboFeedViews 要求四份控制器打包传入，缓存后不必随父级每次渲染换新引用 */
    const feedSources = useMemo(
        () => ({ timeline: timelineFeed, hot: hotFeed, group: groupFeed, likes: likesFeed }),
        [groupFeed, hotFeed, likesFeed, timelineFeed],
    )
    // 个人主页优先：整块替换内容区，返回后原视图与滚动位置由页面状态自然恢复
    if (userTarget !== null) {
        return (
            <UserBlogView
                // 按目标键重挂载：关注态、备注与分组草稿都是主页本地状态，换人时必须整块重置
                key={`${userTarget.kind}:${userTarget.value}`}
                feed={userBlog}
                credential={homeState.credential}
                credentialErrorCode={homeState.errorCode}
                credentialErrorMessage={homeState.errorMessage}
                viewerUid={profileUid}
                onBack={onBack}
                onBlockAuthor={onBlockAuthor}
                onRefresh={onRefresh}
                onOpenSettings={onOpenSettings}
            />
        )
    }
    if (contentKind === 'home') {
        return (
            <WeiboHomeView
                isConfigured={isConfigured}
                homeState={homeState}
                draft={composer.draft}
                images={composer.images}
                onDraftChange={composer.setDraft}
                onImagesChange={composer.setImages}
                onPublished={composer.handlePublished}
                onBlockAuthor={onBlockAuthor}
                viewerUid={profileUid}
                onRefresh={onRefresh}
                onLoadMore={onLoadMore}
                onSaveCredential={onSaveCredential}
                onOpenSettings={onOpenSettings}
            />
        )
    }
    // 热搜页各标签共用一套渲染（只是端点不同），城市由设置弹窗统一提供
    if (contentKind === 'hotRank') {
        return (
            <HotSearchView
                isEnabled={isConfigured}
                view={view}
                cityCode={cityCode}
                state={hotRank.state}
                onRefresh={onRefresh}
                onOpenSettings={onOpenSettings}
            />
        )
    }
    return (
        <WeiboFeedViews
            kind={contentKind}
            feeds={feedSources}
            isConfigured={isConfigured}
            timelineListId={timelineListId}
            activeGroup={activeGroup}
            credential={homeState.credential}
            credentialErrorCode={homeState.errorCode}
            credentialErrorMessage={homeState.errorMessage}
            groupsLoading={groupsState.isLoading}
            groupsErrorMessage={groupsState.errorMessage}
            onReloadGroups={onReloadGroups}
            onBlockAuthor={onBlockAuthor}
            viewerUid={profileUid}
            onRefresh={onRefresh}
            onOpenSettings={onOpenSettings}
        />
    )
}

export function WeiboScreen(): JSX.Element {
    // 屏蔽名单与 Cookie 无关：页面打开就读取，被所有信息流共用
    const blockList = useWeiboBlockList()
    /** 过滤规则：只取两个名单，引用稳定，避免每轮渲染重算整条列表 */
    const blockRules = useMemo(
        () => ({ blockedUsers: blockList.state.blockedUsers, blockedKeywords: blockList.state.blockedKeywords }),
        [blockList.state.blockedKeywords, blockList.state.blockedUsers],
    )
    const {
        state: homeState,
        refresh: refreshHome,
        loadMore: loadMoreHome,
        prepend: prependHome,
        saveCredential,
        clearCredential,
    } = useWeiboTimeline(blockRules)
    const isConfigured = homeState.credential?.isConfigured ?? false
    const { state: profileState } = useWeiboProfile(isConfigured)
    const { state: groupsState, reload: reloadGroups } = useWeiboGroups({ enabled: isConfigured })
    // 同城城市与 Cookie 无关：页面打开就读取，供热搜页「同城」榜与设置弹窗共用
    const city = useWeiboCity()
    /** 个人主页用的 uid：账号信息优先，分组结果兜底；空串按「没有 uid」处理，避免拼出空地址 */
    const profileUid = profileState.profile?.id || groupsState.groups?.uid || null

    /** 视图导航：当前视图、页内主页目标与菜单 / 主页入口的切换动作都在 Hook 里 */
    const { view, userTarget, selectView, selectHome, openLikes, openUser, closeUser, openProfile } = useWeiboPageNav({
        profileUid,
    })
    /** 分组衍生值：我的分组、频道池与时间线 list_id */
    const { myGroups, hotChannelPool, timelineListId } = useWeiboGroupsView(groupsState)

    /** 页面根节点：滚动宿主藏在 AppContent 的 ScrollArea 里，刷新与切页都从它往下找 */
    const pageRef = useRef<HTMLDivElement>(null)
    /** 回到顶部按钮：滚动超过一小段就出现，与切页 / 刷新的归零动作共用同一个滚动宿主 */
    const { isVisible: isScrollTopVisible, scrollToTop } = useScrollTopVisibility(pageRef, SCROLL_TOP_THRESHOLD)
    // 设置改为弹窗：不再占用导航视图
    const [isSettingsOpen, setIsSettingsOpen] = useState(false)
    /** 发布框草稿与已选图片放在页面层：切到其它视图时首页内容会卸载，二者不能跟着丢 */
    const composer = useWeiboComposerDraft({ prepend: prependHome })
    useHostToast()
    /** 热门频道菜单：会话内增删与「加不进去不切视图」的规则都在 hooks 里 */
    const {
        hotChannels,
        candidates: hotChannelCandidates,
        addChannel,
        removeChannel,
    } = useWeiboHotChannelMenu({
        pool: hotChannelPool,
        view,
        onSelectView: selectView,
    })

    /** 取数装配：四个信息流、热搜榜单与当前视图的 activeFeed 都由 Hook 给出 */
    const feeds = useWeiboPageFeeds({
        isConfigured,
        view,
        blockRules,
        timelineListId,
        myGroups,
        cityCode: city.state.cityCode,
    })
    const { activeFeed, hotRankTab, hotListId } = feeds
    /** 页内个人主页取数：目标为空时不发请求，进入主页才取该用户的资料与微博 */
    const userBlog = useWeiboUserBlog(userTarget, isConfigured && userTarget !== null, blockRules)
    /** 顶栏刷新：分发到主页 / 信息流 / 热搜 / 首页，摘要与动作同源 */
    const { refresh: handleRefresh, summary: refreshSummary } = useWeiboRefresh({
        pageRef,
        view,
        userTarget,
        activeFeed,
        hotRankTab,
        hotRankState: feeds.hotRank.state,
        homeState,
        isConfigured,
        userBlog,
        refreshHome,
        refreshHotRank: feeds.refreshHotRank,
    })
    /** 当前视图该渲染哪块内容：首页 / 时间线 / 我的赞 / 热搜 / 热门 / 自建分组 */
    const contentKind = resolveContentKind(view, hotRankTab, hotListId)

    const handleOpenSettings = useCallback((): void => {
        setIsSettingsOpen(true)
    }, [])

    const removal = useCredentialRemoval({ clearCredential, onCleared: selectHome })
    const { requestDelete } = removal

    /**
     * 删除 Cookie：先打开确认框，真正清除在 Hook 里。
     * 关键约束：首页凭证卡与账号菜单共用这一个入口；先收起设置弹窗，避免两个 Radix 弹层叠加。
     */
    const handleRequestDelete = useCallback((): void => {
        setIsSettingsOpen(false)
        requestDelete()
    }, [requestDelete])

    /** 切页或进出个人主页后回到顶部：上一屏可能滚到很深，留着会看不到新屏开头 */
    useEffect(() => {
        scrollAreaToTop(pageRef.current)
    }, [userTarget, view])

    const handleHomeLoadMore = useCallback((): void => {
        void loadMoreHome()
    }, [loadMoreHome])

    /** 屏蔽该博主：写入名单后由 blockRules 驱动的过滤即时生效，提示文案由控制器统一给出 */
    const { blockUser } = blockList
    const handleBlockAuthor = useCallback(
        (authorName: string): void => {
            void blockUser(authorName)
        },
        [blockUser],
    )

    /** 重读分组：菜单里的自建分组随之更新，新增或删除分组都会立刻反映 */
    const handleReloadGroups = useCallback((): void => {
        void reloadGroups()
    }, [reloadGroups])

    /** 内容列宽度：热搜专页没有侧栏，放宽一档，长标题不必挤在 672px 里；
        固定按钮层要复制同一套宽度约束，故抽成一处，避免两处漂移 */
    const contentWidthClass: ContentWidthClass = hotRankTab === null ? 'max-w-2xl' : 'max-w-3xl'

    /** 刷新按钮提示：主页刷该用户的列表、热搜刷当前榜单，其余信息流才是增量 */
    const refreshTooltip =
        userTarget !== null
            ? '重新读取该用户的最新微博'
            : hotRankTab !== null
              ? '刷新当前榜单'
              : '增量刷新：只取上次之后的新内容'

    return (
        <WeiboUserPageProvider openUser={openUser}>
            {/* AppPage 按 h-full 撑满，webview 的 #root 没有高度基准，不给视口高度顶栏会随 body 一起滚走
                （与 WorkflowScreen / dashboardScreen 同形） */}
            <div ref={pageRef} className="flex h-screen min-h-0 flex-col">
                <AppPage>
                    <AppHeader>
                        <AppTitle>微博</AppTitle>
                        <AppAction>
                            {/* 空微博不显示刷新：没有内容可刷，入口交给各视图的空态 */}
                            {refreshSummary.contentCount === 0 ? null : (
                                <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={handleRefresh}
                                    isLoading={refreshSummary.isRefreshing}
                                    disabled={refreshSummary.isRefreshDisabled}
                                    tooltip={refreshTooltip}
                                >
                                    <RefreshCw className="size-3.5" aria-hidden="true" />
                                </Button>
                            )}
                            <WeiboAccountMenu
                                isConfigured={isConfigured}
                                profile={profileState.profile}
                                avatarDataUrl={profileState.avatarDataUrl}
                                isProfileLoading={profileState.isLoading}
                                onOpenProfile={openProfile}
                                onOpenLikes={openLikes}
                                onOpenSettings={handleOpenSettings}
                                onDeleteCredential={handleRequestDelete}
                            />
                        </AppAction>
                        <AppDescription>
                            {userTarget === null
                                ? describeWeiboView({
                                      view,
                                      isConfigured,
                                      savedAt: homeState.credential?.savedAt ?? null,
                                      groups: myGroups,
                                      hotChannels,
                                  })
                                : describeUserPage(isConfigured, userBlog.state.user)}
                        </AppDescription>
                        <AppMenu>
                            <WeiboNav
                                active={view}
                                onSelect={selectView}
                                customGroups={myGroups}
                                hotChannels={hotChannels}
                                hotChannelCandidates={hotChannelCandidates}
                                onAddHotChannel={addChannel}
                                onRemoveHotChannel={removeChannel}
                            />
                        </AppMenu>
                    </AppHeader>

                    <AppContent isScrollable className="gap-3 p-3">
                        <div className="mx-auto flex w-full max-w-5xl items-start justify-center gap-3 py-1">
                            <div className="flex min-w-0 flex-1">
                                {/* 热搜页没有侧栏，内容区放宽一档，长标题不必挤在 672px 里 */}
                                <div className={cn('flex min-w-0 flex-1 flex-col gap-3', contentWidthClass)}>
                                    <WeiboContentView
                                        isConfigured={isConfigured}
                                        contentKind={contentKind}
                                        view={view}
                                        userTarget={userTarget}
                                        userBlog={userBlog}
                                        homeState={homeState}
                                        feeds={feeds}
                                        cityCode={city.state.cityCode}
                                        composer={composer}
                                        timelineListId={timelineListId}
                                        groupsState={groupsState}
                                        profileUid={profileUid}
                                        onBack={closeUser}
                                        onBlockAuthor={handleBlockAuthor}
                                        onRefresh={handleRefresh}
                                        onOpenSettings={handleOpenSettings}
                                        onLoadMore={handleHomeLoadMore}
                                        onReloadGroups={handleReloadGroups}
                                        onSaveCredential={saveCredential}
                                    />
                                </div>
                            </div>
                            {/* 热搜专页自带整页榜单，故该页不渲染侧栏卡片，避免同一份内容出现两次 */}
                            {hotRankTab === null ? <HotRankAside isEnabled={isConfigured} /> : null}
                        </div>
                        <ScrollTopButton
                            isVisible={isScrollTopVisible}
                            contentWidthClass={contentWidthClass}
                            hasAside={hotRankTab === null}
                            onScrollToTop={scrollToTop}
                        />
                    </AppContent>
                </AppPage>
            </div>
            <SettingsDialog
                isOpen={isSettingsOpen}
                onOpenChange={setIsSettingsOpen}
                cityCode={city.state.cityCode}
                cityError={city.state.errorMessage}
                isCityLoading={city.state.isLoading}
                isCitySaving={city.state.isSaving}
                onSaveCity={city.save}
                blockList={blockList}
            />
            <AlertDialog
                open={removal.isDeleteOpen}
                title="删除登录 Cookie？"
                description="删除后信息流、热搜与表情都会停止读取，需要重新登录 weibo.com 复制 Cookie 才能恢复。"
                confirmLabel={removal.isDeleting ? '正在删除…' : '删除'}
                isDestructive
                isSubmitting={removal.isDeleting}
                onOpenChange={removal.setDeleteOpen}
                onConfirm={() => {
                    void removal.confirmDelete()
                }}
            />
            <AppToaster />
        </WeiboUserPageProvider>
    )
}
