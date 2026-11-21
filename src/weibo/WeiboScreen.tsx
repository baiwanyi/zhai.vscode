/**
 * 微博页：编辑区独立页，顶部菜单切换首页 / 时间线 / 热门 / 热搜与账号自建分组，
 * 顶栏动作区只剩「刷新」与账号菜单（头像 + 个人主页 / 我的赞 / 设置弹窗 / 删除 Cookie）。
 * 复用约定：页面骨架取 @webview/components/AppPage，取数装配走 useWeiboPageFeeds，
 * 凭证删除走 useCredentialRemoval，草稿与已选图片走 useWeiboComposerDraft；
 * 视图组件交给 layout（WeiboHomeView / WeiboFeedViews / PageHotSearch / HotRankAside / WeiboNav），
 * 视图判定与文案交给 utils（weiboFeedRouting / weiboViewDescription），本文件只做装配与分发。
 * 关键约束：未配置 Cookie 时任何信息流都不发请求，只给可执行的获取步骤；
 * 凭证探测未结束或失败时不得断言「没有配置」，由 CredentialGate / CredentialCard 给加载与失败态；
 * 顶栏「刷新」按当前视图分发：信息流刷自己的游标，热搜刷当前标签的榜单；
 * 热搜专页不再渲染右侧热搜卡，避免同一份榜单出现两次；
 * Cookie 明文只存在于输入瞬间，删除只有一个确认入口且提交中禁用；
 * 发布草稿与已选图片由页面层持有，切到其它视图再回首页仍在。
 */
import { cn } from 'cn'
import { RefreshCw } from 'lucide-react'
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
import { useCredentialRemoval } from './hooks/useCredentialRemoval'
import { useWeiboBlockList } from './hooks/useWeiboBlockList'
import { useWeiboCity } from './hooks/useWeiboCity'
import { useWeiboComposerDraft } from './hooks/useWeiboComposerDraft'
import { useWeiboGroups } from './hooks/useWeiboGroups'
import { useWeiboHotChannelMenu } from './hooks/useWeiboHotChannelMenu'
import { useWeiboOpenUrl } from './hooks/useWeiboOpenUrl'
import { useWeiboPageFeeds } from './hooks/useWeiboPageFeeds'
import { useWeiboProfile } from './hooks/useWeiboProfile'
import { useWeiboTimeline } from './hooks/useWeiboTimeline'
import { HotRankAside } from './layout/HotRankAside'
import { PageHotSearch } from './layout/PageHotSearch'
import { SettingsDialog } from './layout/SettingsDialog'
import { WeiboAccountMenu } from './layout/WeiboAccountMenu'
import { WeiboFeedViews } from './layout/WeiboFeedViews'
import { WeiboHomeView } from './layout/WeiboHomeView'
import { WeiboNav } from './layout/WeiboNav'
import { HOME_RECOMMEND_VIEW } from './layout/weiboNavGroups'
import { readRefreshSummary, resolveContentKind } from './utils/weiboFeedRouting'
import { buildProfileUrl } from './utils/weiboLinks'
import { describeWeiboView } from './utils/weiboViewDescription'
import type { WeiboView } from './layout/weiboNavGroups'
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
    /** 页面根节点：滚动宿主藏在 AppContent 的 ScrollArea 里，刷新与切页都从它往下找 */
    const pageRef = useRef<HTMLDivElement>(null)
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
        onSelectView: setView,
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
    /** 顶栏刷新摘要：加载态、可用性与内容条数由 utils 统一判定 */
    const refreshSummary = readRefreshSummary({
        view,
        activeFeed,
        hotRankTab,
        hotRankState: feeds.hotRank.state,
        homeState,
        isConfigured,
    })
    /** 个人主页用的 uid：账号信息优先，分组结果兜底；空串按「没有 uid」处理，避免拼出空地址 */
    const rawProfileUid = profileState.profile?.id ?? groupsState.groups?.uid ?? null
    const profileUid = rawProfileUid !== null && rawProfileUid.length > 0 ? rawProfileUid : null
    /** 当前视图该渲染哪块内容：首页 / 时间线 / 我的赞 / 热搜 / 热门 / 自建分组 */
    const contentKind = resolveContentKind(view, hotRankTab, hotListId)

    const handleOpenSettings = useCallback((): void => {
        setIsSettingsOpen(true)
    }, [])

    const handleCredentialCleared = useCallback((): void => {
        setView(HOME_RECOMMEND_VIEW)
    }, [])

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

    /** 切页后回到顶部：上一页可能滚到很深，留着会看不到新页开头 */
    useEffect(() => {
        scrollAreaToTop(pageRef.current)
    }, [view])

    const handleRefresh = useCallback((): void => {
        // 刷新等于重开一屏：先把滚动条拉回顶部，新内容从第一条看起
        scrollAreaToTop(pageRef.current)
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
    }, [activeFeed, hotRankTab, refreshHome, refreshHotRank])

    const handleHomeLoadMore = useCallback((): void => {
        void loadMoreHome()
    }, [loadMoreHome])

    /** 打开我的赞：入口在账号菜单，切换视图后由 likesFeed 负责首屏取数 */
    const handleOpenLikes = useCallback((): void => {
        setView('mine.likes')
    }, [])

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

    const openUrl = useWeiboOpenUrl()

    /** 个人主页：uid 缺失时只提示，不拼空地址；地址构造交给 utils/weiboLinks */
    const handleOpenProfile = useCallback((): void => {
        if (profileUid === null) {
            toast.info('还没有识别到账号：保存 Cookie 后会自动读取')
            return
        }
        openUrl(buildProfileUrl(profileUid))
    }, [openUrl, profileUid])

    function renderContent(): JSX.Element {
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
        <>
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
                                    tooltip="增量刷新：只取上次之后的新内容"
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
                            {describeWeiboView({
                                view,
                                isConfigured,
                                savedAt: homeState.credential?.savedAt ?? null,
                                groups: myGroups,
                                hotChannels,
                            })}
                        </AppDescription>
                        <AppMenu>
                            <WeiboNav
                                active={view}
                                onSelect={setView}
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
        </>
    )
}
