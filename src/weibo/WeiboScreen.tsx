/**
 * 微博页：编辑区独立页，顶部菜单切换首页 / 时间线 / 热门 / 热搜与账号自建分组，
 * 顶栏动作区只剩「刷新」与账号菜单（头像 + 个人主页 / 我的赞 / 设置弹窗 / 删除 Cookie）。
 * 复用约定：页面骨架取 @webview/components/AppPage，取数装配走 useWeiboPageFeeds，
 * 凭证删除走 useCredentialRemoval，草稿与已选图片走 useWeiboComposerDraft，
 * 页内个人主页的目标与取数走 WeiboUserPageProvider + useWeiboUserBlog；
 * 视图组件交给 layout（WeiboHomeView / WeiboFeedViews / PageHotSearch / PageUserBlog / HotRankAside / WeiboNav），
 * 视图判定与文案交给 utils（weiboFeedRouting / weiboViewDescription），本文件只做装配与分发。
 * 关键约束：未配置 Cookie 时任何信息流都不发请求，只给可执行的获取步骤；
 * 凭证探测未结束或失败时不得断言「没有配置」，由 CredentialGate / CredentialCard 给加载与失败态；
 * 顶栏「刷新」按当前视图分发：信息流刷自己的游标，热搜刷当前标签的榜单，个人主页刷该用户的列表；
 * 个人主页优先于视图内容：/u/ 与 /n/ 链接经 WeiboUserPageProvider 交回本页打开，切页与删 Cookie 都清空该目标；
 * 信息流滚动超过一小段后，视口右下角（fixed，向左让出 320px 贴住内容列右缘）出现「回到顶部」按钮，
 * 点击与切页 / 刷新共用同一个 scrollAreaToTop 归零；
 * 热搜专页不再渲染右侧热搜卡，避免同一份榜单出现两次；
 * Cookie 明文只存在于输入瞬间，删除只有一个确认入口且提交中禁用；
 * 发布草稿与已选图片由页面层持有，切到其它视图再回首页仍在。
 */
import { cn } from 'cn'
import { ArrowUp, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { scrollAreaToTop } from '@shared/utils/scrollArea'
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
import { ConfirmDialog } from '@webview/components/ConfirmDialog'
import { useHostToast } from '@webview/hooks/useHostToast'
import { WeiboUserPageProvider } from './context/WeiboUserPageProvider'
import { useCredentialRemoval } from './hooks/useCredentialRemoval'
import { useScrollTopVisibility } from './hooks/useScrollTopVisibility'
import { useWeiboBlockList } from './hooks/useWeiboBlockList'
import { useWeiboCity } from './hooks/useWeiboCity'
import { useWeiboComposerDraft } from './hooks/useWeiboComposerDraft'
import { useWeiboGroups } from './hooks/useWeiboGroups'
import { useWeiboHotChannelMenu } from './hooks/useWeiboHotChannelMenu'
import { useWeiboPageFeeds } from './hooks/useWeiboPageFeeds'
import { useWeiboProfile } from './hooks/useWeiboProfile'
import { useWeiboTimeline } from './hooks/useWeiboTimeline'
import { useWeiboUserBlog } from './hooks/useWeiboUserBlog'
import { HotRankAside } from './layout/HotRankAside'
import { PageHotSearch } from './layout/PageHotSearch'
import { PageUserBlog } from './layout/PageUserBlog'
import { SettingsDialog } from './layout/SettingsDialog'
import { WeiboAccountMenu } from './layout/WeiboAccountMenu'
import { WeiboFeedViews } from './layout/WeiboFeedViews'
import { WeiboHomeView } from './layout/WeiboHomeView'
import { WeiboNav } from './layout/WeiboNav'
import { HOME_RECOMMEND_VIEW } from './layout/weiboNavGroups'
import { readRefreshSummary, resolveContentKind } from './utils/weiboFeedRouting'
import { describeWeiboView } from './utils/weiboViewDescription'
import type { WeiboView } from './layout/weiboNavGroups'
import type { WeiboUserTarget } from './utils/weiboLinks'
import type { JSX } from 'react'

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
    const [view, setView] = useState<WeiboView>(HOME_RECOMMEND_VIEW)
    /** 页内个人主页：非空时内容区整块换成该用户的主页，返回即清空 */
    const [userTarget, setUserTarget] = useState<WeiboUserTarget | null>(null)
    /** 切页统一清空主页目标：顶部菜单与热门频道都走这里，避免停在别人的主页上继续看别的流 */
    const handleSelectView = useCallback((next: WeiboView): void => {
        setUserTarget(null)
        setView(next)
    }, [])
    /** 页面根节点：滚动宿主藏在 AppContent 的 ScrollArea 里，刷新与切页都从它往下找 */
    const pageRef = useRef<HTMLDivElement>(null)
    /** 回到顶部按钮：滚动超过一小段就出现，与切页 / 刷新的归零动作共用同一个滚动宿主 */
    const { isVisible: isScrollTopVisible, scrollToTop } = useScrollTopVisibility(pageRef, 120)
    // 设置改为弹窗：不再占用导航视图
    const [isSettingsOpen, setIsSettingsOpen] = useState(false)
    /** 发布框草稿与已选图片放在页面层：切到其它视图时首页内容会卸载，二者不能跟着丢 */
    const composer = useWeiboComposerDraft({ prepend: prependHome })
    useHostToast()

    const isConfigured = homeState.credential?.isConfigured ?? false
    const { state: profileState } = useWeiboProfile(isConfigured)
    const { state: groupsState, reload: reloadGroups } = useWeiboGroups({ enabled: isConfigured })
    // 同城城市与 Cookie 无关：页面打开就读取，供热搜页「同城」榜与设置弹窗共用
    const city = useWeiboCity()
    /** 我的分组：自建分组直接进菜单，用 useMemo 稳定引用，避免每轮渲染都重算依赖 */
    const myGroups = useMemo(() => groupsState.groups?.myGroups ?? [], [groupsState.groups])
    /** 频道池：allGroups 的「我的频道 / 频道推荐」，只作候选来源，不直接全量上菜单 */
    const hotChannelPool = useMemo(() => groupsState.groups?.hotChannels ?? [], [groupsState.groups])
    /** 热门频道菜单：会话内增删与「加不进去不切视图」的规则都在 hooks 里 */
    const {
        hotChannels,
        candidates: hotChannelCandidates,
        addChannel,
        removeChannel,
    } = useWeiboHotChannelMenu({
        pool: hotChannelPool,
        view,
        onSelectView: handleSelectView,
    })

    const timelineListId = groupsState.groups?.timelineListId ?? null
    /** 取数装配：四个信息流、热搜榜单与当前视图的 activeFeed 都由 Hook 给出 */
    const feeds = useWeiboPageFeeds({
        isConfigured,
        view,
        blockRules,
        timelineListId,
        myGroups,
        cityCode: city.state.cityCode,
    })
    const { activeFeed, hotRankTab, hotListId, refreshHotRank } = feeds
    /** 页内个人主页取数：目标为空时不发请求，进入主页才取该用户的资料与微博 */
    const userBlog = useWeiboUserBlog(userTarget, isConfigured && userTarget !== null, blockRules)
    const { refresh: refreshUserBlog } = userBlog
    /** 顶栏刷新摘要：主页优先（刷新的是该用户的列表），其余由 utils 统一判定 */
    const refreshSummary =
        userTarget === null
            ? readRefreshSummary({
                  view,
                  activeFeed,
                  hotRankTab,
                  hotRankState: feeds.hotRank.state,
                  homeState,
                  isConfigured,
              })
            : {
                  isRefreshing: userBlog.state.isRefreshing,
                  isRefreshDisabled: !isConfigured,
                  contentCount: userBlog.state.posts.length,
              }
    /** 个人主页用的 uid：账号信息优先，分组结果兜底；空串按「没有 uid」处理，避免拼出空地址 */
    const rawProfileUid = profileState.profile?.id ?? groupsState.groups?.uid ?? null
    const profileUid = rawProfileUid !== null && rawProfileUid.length > 0 ? rawProfileUid : null
    /** 当前视图该渲染哪块内容：首页 / 时间线 / 我的赞 / 热搜 / 热门 / 自建分组 */
    const contentKind = resolveContentKind(view, hotRankTab, hotListId)

    const handleOpenSettings = useCallback((): void => {
        setIsSettingsOpen(true)
    }, [])

    const handleCredentialCleared = useCallback((): void => {
        handleSelectView(HOME_RECOMMEND_VIEW)
    }, [handleSelectView])

    const removal = useCredentialRemoval({ clearCredential, onCleared: handleCredentialCleared })
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

    const handleRefresh = useCallback((): void => {
        // 刷新等于重开一屏：先把滚动条拉回顶部，新内容从第一条看起
        scrollAreaToTop(pageRef.current)
        // 个人主页：刷新的是该用户的列表，与顶栏按钮共用同一份状态
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
    }, [activeFeed, hotRankTab, refreshHome, refreshHotRank, refreshUserBlog, userTarget])

    const handleHomeLoadMore = useCallback((): void => {
        void loadMoreHome()
    }, [loadMoreHome])

    /** 打开我的赞：入口在账号菜单，切换视图后由 likesFeed 负责首屏取数 */
    const handleOpenLikes = useCallback((): void => {
        handleSelectView('mine.likes')
    }, [handleSelectView])

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

    /** 页内打开个人主页：正文与标题行链接命中 /u/ 或 /n/ 时由 useWeiboOpenUrl 交给这里 */
    const openUser = useCallback((target: WeiboUserTarget): void => {
        setUserTarget(target)
    }, [])

    /** 关闭个人主页：只清空目标，原视图与已加载内容原地保留 */
    const closeUser = useCallback((): void => {
        setUserTarget(null)
    }, [])

    /** 个人主页：uid 缺失时只提示，不拼空地址；有 uid 时页内打开，不再跳浏览器 */
    const handleOpenProfile = useCallback((): void => {
        if (profileUid === null) {
            toast.info('还没有识别到账号：保存 Cookie 后会自动读取')
            return
        }
        openUser({ kind: 'uid', value: profileUid })
    }, [openUser, profileUid])

    function renderContent(): JSX.Element {
        // 个人主页优先：整块替换内容区，返回后原视图与滚动位置由页面状态自然恢复
        if (userTarget !== null) {
            return (
                <PageUserBlog
                    // 按目标键重挂载：关注态、备注与分组草稿都是主页本地状态，换人时必须整块重置
                    key={`${userTarget.kind}:${userTarget.value}`}
                    feed={userBlog}
                    credential={homeState.credential}
                    credentialErrorCode={homeState.errorCode}
                    credentialErrorMessage={homeState.errorMessage}
                    viewerUid={profileUid}
                    onBack={closeUser}
                    onBlockAuthor={handleBlockAuthor}
                    onRefresh={handleRefresh}
                    onOpenSettings={handleOpenSettings}
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
                    onBlockAuthor={handleBlockAuthor}
                    viewerUid={profileUid}
                    onRefresh={handleRefresh}
                    onLoadMore={handleHomeLoadMore}
                    onSaveCredential={saveCredential}
                    onOpenSettings={handleOpenSettings}
                />
            )
        }
        // 热搜页各标签共用一套渲染（只是端点不同），城市由设置弹窗统一提供
        if (contentKind === 'hotRank') {
            return (
                <PageHotSearch
                    isEnabled={isConfigured}
                    view={view}
                    cityCode={city.state.cityCode}
                    state={feeds.hotRank.state}
                    onRefresh={handleRefresh}
                    onOpenSettings={handleOpenSettings}
                />
            )
        }
        return (
            <WeiboFeedViews
                kind={contentKind}
                feeds={{
                    timeline: feeds.timelineFeed,
                    hot: feeds.hotFeed,
                    group: feeds.groupFeed,
                    likes: feeds.likesFeed,
                }}
                isConfigured={isConfigured}
                timelineListId={timelineListId}
                activeGroup={feeds.activeGroup}
                credential={homeState.credential}
                credentialErrorCode={homeState.errorCode}
                credentialErrorMessage={homeState.errorMessage}
                groupsLoading={groupsState.isLoading}
                groupsErrorMessage={groupsState.errorMessage}
                onReloadGroups={handleReloadGroups}
                onBlockAuthor={handleBlockAuthor}
                viewerUid={profileUid}
                onRefresh={handleRefresh}
                onOpenSettings={handleOpenSettings}
            />
        )
    }

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
                                    tooltip={
                                        userTarget === null
                                            ? '增量刷新：只取上次之后的新内容'
                                            : '重新读取该用户的最新微博'
                                    }
                                >
                                    <RefreshCw className="size-3.5" aria-hidden="true" />
                                </Button>
                            )}
                            <WeiboAccountMenu
                                isConfigured={isConfigured}
                                profile={profileState.profile}
                                avatarDataUrl={profileState.avatarDataUrl}
                                isProfileLoading={profileState.isLoading}
                                onOpenProfile={handleOpenProfile}
                                onOpenLikes={handleOpenLikes}
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
                                : `个人主页 · ${userBlog.state.user?.name ?? '正在读取…'}`}
                        </AppDescription>
                        <AppMenu>
                            <WeiboNav
                                active={view}
                                onSelect={handleSelectView}
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
                            {/* 热搜页没有侧栏，内容区放宽一档，长标题不必挤在 672px 里 */}
                            <div
                                className={cn(
                                    'flex min-w-0 flex-1 flex-col gap-3',
                                    hotRankTab === null ? 'max-w-2xl' : 'max-w-3xl',
                                )}
                            >
                                {renderContent()}
                            </div>
                            {/* 热搜专页自带整页榜单，故该页不渲染侧栏卡片，避免同一份内容出现两次 */}
                            {hotRankTab === null ? <HotRankAside isEnabled={isConfigured} /> : null}
                            {/* 回到顶部：必须 fixed 才能钉在视口右下角（sticky 会被内容列高度牵走、滚到底才停住）；
                                w-80 从右缘向左让出 320px，让按钮落在内容列右缘附近而不是压住右侧热搜卡 */}
                            {isScrollTopVisible ? (
                                <div className="fixed right-4 bottom-4 z-10 flex w-80">
                                    <Button
                                        size="icon"
                                        variant="outline"
                                        className="size-12"
                                        tooltip="回到顶部"
                                        aria-label="回到顶部"
                                        onClick={scrollToTop}
                                    >
                                        <ArrowUp className="size-6" aria-hidden="true" />
                                    </Button>
                                </div>
                            ) : null}
                        </div>
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
            <ConfirmDialog
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
