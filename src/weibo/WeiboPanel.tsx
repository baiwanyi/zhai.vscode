/**
 * 微博面板：编辑区独立页，顶部菜单切换首页 / 时间线 / 热门 / 热搜与账号自建分组，
 * 顶栏动作区只剩「刷新」与账号菜单（头像 + 个人主页 / 我的赞 / 设置弹窗 / 删除 Cookie）。
 * 复用约定：页面骨架取 @webview/components/AppPage，取数状态来自 hooks 下的时间线、信息流、分组、热搜、城市与频道菜单控制器；
 * 视图结构交给 layout（ComposerCard / CredentialCard / SettingsDialog / WeiboFeedSection / PageHotSearch），
 * 视图说明与刷新判定交给 utils（weiboViewCopy / weiboFeedRouting），本文件只做控制器装配与视图分发。
 * 关键约束：未配置 Cookie 时任何信息流都不发请求，只给可执行的获取步骤；
 * 凭证探测未结束或失败时不得断言「没有配置」，由 layout/CredentialGate 统一给加载态与失败态；
 * 顶栏「刷新」按当前视图分发：信息流刷自己的游标，热搜刷当前标签的榜单；
 * 热搜专页不再渲染右侧热搜卡，避免同一份榜单出现两次；
 * Cookie 输入框不回显已保存值，保存成功后清空、由登录态变化自动换出凭证卡，明文只存在于输入瞬间；
 * 删除 Cookie 只有一个确认入口（账号菜单），确认后回首页，凭证卡按未配置状态自然出现；
 * 同城热搜城市在设置弹窗里选择，落 zhai.weibo.cityCode，与 Cookie 无关；
 * 时间线、热门、热搜与分组本身只读（卡片评论区可写），发布框已接入发布（图床换 pid → update 提交），
 * 支持表情、话题插入与本地图片选择/粘贴上传，草稿与已选图片由面板层保留，发布成功即清空并刷新首页；
 * 评论区支持发布 / 回复 / 删除自己的评论，账号 uid 取自账号信息（缺省用分组结果）并逐层透传给卡片；
 * 发布框草稿由面板层持有：切到其它视图再回首页，已写内容仍在，不随首页内容卸载丢失；
 * 个人主页按账号 uid 拼 weibo.com 地址交给宿主打开，入口收在顶栏账号菜单里；
 * 我的赞同样收在账号菜单里，视图为 mine.likes，只有页码分页，uid 由宿主解析；
 * 屏蔽名单（用户名 / 关键字）由设置弹窗维护，取数 hook 返回前统一过滤，卡片「屏蔽该博主」只追加名单；
 * 账号信息与头像由 weibo/profile 提供（头像已是 data URI），取不到 uid 时只提示而不拼空地址。
 */
import { cn } from 'cn'
import { Inbox, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@components/ui/alert-dialog'
import { Toaster } from '@components/ui/sonner'
import type { UploadFileItem } from '@shared/types/upload'
import type { WeiboTimelinePost } from '@shared/types/weibo'
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
import { Button } from '@webview/components/Button'
import { StateEmpty } from '@webview/components/StateEmpty'
import { useHostToast } from '@webview/hooks/useHostToast'
import { useVscodeTheme } from '@webview/hooks/useVscodeTheme'
import { useWeiboBlockList } from './hooks/useWeiboBlockList'
import { useWeiboCity } from './hooks/useWeiboCity'
import { useWeiboFeed } from './hooks/useWeiboFeed'
import { useWeiboGroups } from './hooks/useWeiboGroups'
import { useWeiboHotChannelMenu } from './hooks/useWeiboHotChannelMenu'
import { useWeiboHotRank } from './hooks/useWeiboHotRank'
import { useWeiboLikes } from './hooks/useWeiboLikes'
import { useWeiboOpenUrl } from './hooks/useWeiboOpenUrl'
import { useWeiboProfile } from './hooks/useWeiboProfile'
import { useWeiboTimeline } from './hooks/useWeiboTimeline'
import { ComposerCard } from './layout/ComposerCard'
import { CredentialCard } from './layout/CredentialCard'
import { CredentialGate } from './layout/CredentialGate'
import { PageHotSearch } from './layout/PageHotSearch'
import { SettingsDialog } from './layout/SettingsDialog'
import { WeiboAccountMenu } from './layout/WeiboAccountMenu'
import { WeiboFeedList } from './layout/WeiboFeedList'
import { WeiboFeedSection } from './layout/WeiboFeedSection'
import { WeiboHotRankList } from './layout/WeiboHotRankList'
import { WeiboNav } from './layout/WeiboNav'
import { readCustomGroupId, readHotChannelGid, readHotRankTab, readWeiboViewLabel } from './layout/weiboNavGroups'
import { pickActiveFeed, readRefreshSummary } from './utils/weiboFeedRouting'
import { buildProfileUrl } from './utils/weiboLinks'
import { describeWeiboView } from './utils/weiboViewCopy'
import type { WeiboView } from './layout/weiboNavGroups'
import type { JSX } from 'react'

export function WeiboPanel(): JSX.Element {
    const theme = useVscodeTheme()
    // 屏蔽名单与 Cookie 无关：面板打开就读取，被所有信息流共用
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
    const [view, setView] = useState<WeiboView>('home.recommend')
    /** 页面根节点：滚动宿主藏在 AppContent 的 ScrollArea 里，刷新与切页都从它往下找 */
    const pageRef = useRef<HTMLDivElement>(null)
    // 设置改为弹窗：不再占用导航视图
    const [isSettingsOpen, setIsSettingsOpen] = useState(false)
    // 删除 Cookie 是破坏性操作：先确认，再交宿主清除
    const [isDeleteOpen, setIsDeleteOpen] = useState(false)
    // 发布框草稿放在面板层：切到其它视图时首页内容会卸载，草稿不能跟着丢
    const [draft, setDraft] = useState('')
    // 已选图片同样放在面板层：与草稿一并保留，重新回到首页时发布框还原成离开前的样子
    const [composerImages, setComposerImages] = useState<UploadFileItem[]>([])
    useHostToast()

    const isConfigured = homeState.credential?.isConfigured ?? false
    const { state: profileState } = useWeiboProfile(isConfigured)
    const { state: groupsState, reload: reloadGroups } = useWeiboGroups({ enabled: isConfigured })
    // 同城城市与 Cookie 无关：面板打开就读取，供热搜页「同城」榜与设置弹窗共用
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
        cityCode: city.state.cityCode,
    })

    /** 当前视图的信息流：时间线 / 我的赞 / 热门频道 / 自建分组，判定收敛到 utils */
    const activeFeed = pickActiveFeed(view, {
        timeline: timelineFeed,
        hot: hotFeed,
        group: groupFeed,
        likes: likesFeed,
    })
    /** 顶栏刷新摘要：加载态、可用性与内容条数由 utils 统一判定 */
    const refreshSummary = readRefreshSummary({
        view,
        activeFeed,
        hotRankTab,
        hotRankState: hotRank.state,
        homeState,
        isConfigured,
    })
    /** 个人主页用的 uid：账号信息优先，分组结果兜底 */
    const profileUid = profileState.profile?.id ?? groupsState.groups?.uid ?? null

    const handleOpenSettings = useCallback((): void => {
        setIsSettingsOpen(true)
    }, [])

    /**
     * 删除 Cookie：先打开确认框，真正清除在 handleConfirmDelete。
     * 关键约束：首页凭证卡与账号菜单共用这一个入口；先收起设置弹窗，避免两个 Radix 弹层叠加。
     */
    const handleRequestDelete = useCallback((): void => {
        setIsSettingsOpen(false)
        setIsDeleteOpen(true)
    }, [])

    /**
     * 确认删除：清除后回首页。
     * 关键约束：清除后登录态为空，首页按未配置状态自动换出凭证卡，
     * 用户下一步多半是重新登录粘贴新 Cookie，留在原视图会看不到配置入口。
     */
    const handleConfirmDelete = useCallback((): void => {
        void clearCredential().then((isCleared) => {
            if (!isCleared) {
                return
            }
            setView('home.recommend')
        })
    }, [clearCredential])

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
            void hotRank.refresh()
            return
        }
        void refreshHome()
    }, [activeFeed, hotRank, hotRankTab, refreshHome])

    const handleHomeLoadMore = useCallback((): void => {
        void loadMoreHome()
    }, [loadMoreHome])

    /** 发布成功：把新微博直接前插到时间线首位，不刷新整页（游标保持不变） */
    const handlePublished = useCallback(
        (post: WeiboTimelinePost | null): void => {
            if (post === null) {
                return
            }
            prependHome(post)
        },
        [prependHome],
    )

    /** 打开我的赞：入口在账号菜单，切换视图后由 likesFeed 负责首屏取数 */
    const handleOpenLikes = useCallback((): void => {
        setView('mine.likes')
    }, [])

    /** 屏蔽该博主：写入名单后由 blockRules 驱动的过滤即时生效，提示文案由控制器统一给出 */
    const handleBlockAuthor = useCallback(
        (authorName: string): void => {
            void blockList.blockUser(authorName)
        },
        [blockList],
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

    /** 首页：发布框（占位）+ 凭证卡（未登录时）+ 关注时间线 */
    function renderHome(): JSX.Element {
        const shouldShowCredential = !homeState.isLoading && !isConfigured
        return (
            <>
                {shouldShowCredential ? (
                    <CredentialCard isSaving={homeState.isSavingCredential} onSave={saveCredential} />
                ) : (
                    <ComposerCard
                        isEnabled={isConfigured}
                        draft={draft}
                        onDraftChange={setDraft}
                        images={composerImages}
                        onImagesChange={setComposerImages}
                        onPublished={handlePublished}
                    />
                )}

                <WeiboFeedList
                    posts={homeState.posts}
                    isLoading={homeState.isLoading}
                    isLoadingMore={homeState.isLoadingMore}
                    hasMore={homeState.hasMore}
                    errorMessage={homeState.errorMessage}
                    emptyState={
                        isConfigured ? (
                            <StateEmpty
                                className="py-8"
                                icon={Inbox}
                                title="时间线没有内容"
                                description={
                                    homeState.errorMessage ??
                                    '可能是关注列表近期没有更新，也可能是接口返回了空页：稍后刷新一次再试。'
                                }
                            >
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                        void refreshHome()
                                    }}
                                >
                                    刷新
                                </Button>
                            </StateEmpty>
                        ) : (
                            <CredentialGate
                                variant="hint"
                                credential={homeState.credential}
                                errorCode={homeState.errorCode}
                                errorMessage={homeState.errorMessage}
                                onOpenSettings={handleOpenSettings}
                            />
                        )
                    }
                    onBlockAuthor={handleBlockAuthor}
                    viewerUid={profileUid}
                    onLoadMore={handleHomeLoadMore}
                />
            </>
        )
    }

    /** 时间线：默认分组的最新微博，list_id 由分组结果给出 */
    function renderTimelineFeed(): JSX.Element {
        if (isConfigured && timelineListId === null) {
            if (groupsState.isLoading) {
                return <StateEmpty className="py-8" title="正在读取默认分组..." isLoading />
            }
            return (
                <StateEmpty
                    className="py-8"
                    icon={Inbox}
                    title="没有读到默认分组"
                    description={groupsState.errorMessage ?? '默认分组决定时间线的 list_id：刷新分组后再试。'}
                >
                    <Button size="sm" variant="outline" onClick={handleReloadGroups}>
                        重新读取分组
                    </Button>
                </StateEmpty>
            )
        }
        return (
            <WeiboFeedSection
                feed={timelineFeed}
                credential={homeState.credential}
                credentialErrorCode={homeState.errorCode}
                credentialErrorMessage={homeState.errorMessage}
                emptyTitle="时间线没有内容"
                emptyDescription="默认分组近期没有更新，稍后刷新一次再试。"
                onBlockAuthor={handleBlockAuthor}
                viewerUid={profileUid}
                onRefresh={handleRefresh}
                onOpenSettings={handleOpenSettings}
            />
        )
    }

    /** 热门：固定推荐频道，首屏与时间线同为 20 条 */
    function renderHotFeed(): JSX.Element {
        return (
            <WeiboFeedSection
                feed={hotFeed}
                credential={homeState.credential}
                credentialErrorCode={homeState.errorCode}
                credentialErrorMessage={homeState.errorMessage}
                emptyTitle="热门没有内容"
                emptyDescription="推荐频道暂时返回空页，稍后刷新一次再试。"
                onBlockAuthor={handleBlockAuthor}
                viewerUid={profileUid}
                onRefresh={handleRefresh}
                onOpenSettings={handleOpenSettings}
            />
        )
    }

    /**
     * 自建分组：菜单里直接点分组名进来，按该分组的 list_id 取信息流，翻页只在该分组内生效。
     * 关键约束：分组结果还没到（例如刚从其他设备新建）时先给加载态，避免误报「没有内容」。
     */
    function renderGroupFeed(): JSX.Element {
        if (isConfigured && groupsState.isLoading && activeGroup === null) {
            return <StateEmpty className="py-8" title="正在读取分组..." isLoading />
        }
        return (
            <WeiboFeedSection
                feed={groupFeed}
                credential={homeState.credential}
                credentialErrorCode={homeState.errorCode}
                credentialErrorMessage={homeState.errorMessage}
                emptyTitle={`「${activeGroup?.title ?? '该分组'}」没有内容`}
                emptyDescription="分组近期没有更新，稍后刷新一次再试。"
                onBlockAuthor={handleBlockAuthor}
                viewerUid={profileUid}
                onRefresh={handleRefresh}
                onOpenSettings={handleOpenSettings}
            />
        )
    }

    /** 我的赞：点赞过的微博按点赞时间倒序，只有页码分页，翻页只追加 */
    function renderLikesFeed(): JSX.Element {
        return (
            <WeiboFeedSection
                feed={likesFeed}
                credential={homeState.credential}
                credentialErrorCode={homeState.errorCode}
                credentialErrorMessage={homeState.errorMessage}
                emptyTitle="还没有点赞"
                emptyDescription="在微博里点过赞的内容会按时间倒序出现在这里。"
                onBlockAuthor={handleBlockAuthor}
                viewerUid={profileUid}
                onRefresh={handleRefresh}
                onOpenSettings={handleOpenSettings}
            />
        )
    }

    /**
     * 规划已就位但接口未接入的频道：只给说明，不发请求。
     * 关键约束：这类频道不能落回首页内容，否则用户以为切换没生效。
     */
    function renderPlannedView(): JSX.Element {
        return (
            <StateEmpty
                className="py-8"
                icon={Inbox}
                title={`${readWeiboViewLabel(view, myGroups, hotChannels)} 暂未接入`}
                description="菜单结构已按规划就位，这个频道的数据接口还没接上：接入后这里会显示对应的信息流。"
            />
        )
    }

    function renderContent(): JSX.Element {
        if (view === 'home.recommend') {
            return renderHome()
        }
        if (view === 'home.timeline') {
            return renderTimelineFeed()
        }
        if (view === 'mine.likes') {
            return renderLikesFeed()
        }
        // 热搜页各标签共用一套渲染（只是端点不同），城市由设置弹窗统一提供
        if (hotRankTab !== null) {
            return (
                <PageHotSearch
                    isEnabled={isConfigured}
                    view={view}
                    cityCode={city.state.cityCode}
                    state={hotRank.state}
                    onRefresh={handleRefresh}
                    onOpenSettings={handleOpenSettings}
                />
            )
        }
        // 热门各频道共用一套渲染（只是 group_id 不同），自建分组与规划中的频道才继续分流
        if (hotListId !== null) {
            return renderHotFeed()
        }
        return activeGroupId === null ? renderPlannedView() : renderGroupFeed()
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
                            {/* 右侧热搜榜：热搜专页自带整页榜单，故该页不渲染侧栏卡片，避免同一份内容出现两次。
                                三件事缺一不可：@3xl:block 让 hidden 在该档恢复显示、
                                self-start 避免被拉伸到内容高度（拉满后 sticky 没有可粘的行程）、
                                sticky + top 让它在 AppContent 的滚动区里钉住不随列表滚走 */}
                            {hotRankTab === null ? (
                                <aside className="hidden w-80 shrink-0 @3xl:sticky @3xl:top-1 @3xl:block @3xl:self-start">
                                    <WeiboHotRankList isEnabled={isConfigured} />
                                </aside>
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
            <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>删除登录 Cookie？</AlertDialogTitle>
                        <AlertDialogDescription>
                            删除后信息流、热搜与表情都会停止读取，需要重新登录 weibo.com 复制 Cookie 才能恢复。
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction variant="destructive" onClick={handleConfirmDelete}>
                            删除
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            <Toaster theme={theme} />
        </>
    )
}
