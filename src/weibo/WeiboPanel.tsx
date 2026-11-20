/**
 * 微博面板：编辑区独立页，顶部菜单切换首页 / 时间线 / 热门 / 分组，
 * 顶栏动作区只剩「刷新」与账号菜单（头像 + 个人主页 / 设置弹窗 / 删除 Cookie）。
 * 复用约定：页面骨架取 @webview/components/AppPage，卡片取 @components/ui/card，
 * 取数状态分别来自 hooks 下的关注时间线、信息流与分组控制器，
 * 列表渲染统一交给 layout/WeiboFeedList，单条仍是 layout/WeiboPostCard，
 * 空态复用 StateEmpty，操作反馈用 sonner（Toaster 主题取 useVscodeTheme）。
 * 关键约束：未配置 Cookie 时任何信息流都不发请求，只给可执行的获取步骤；
 * Cookie 输入框不回显已保存值，保存成功后清空并收起，明文只存在于输入瞬间；
 * 时间线、热门与分组都是只读浏览，发布框仍是占位（写接口不在本次范围）；
 * 个人主页按账号 uid 拼 weibo.com 地址交给宿主打开，入口收在顶栏账号菜单里；
 * 账号信息与头像由 weibo/profile 提供（头像已是 data URI），取不到 uid 时只提示而不拼空地址。
 */
import { format } from 'date-fns'
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
import { Card, CardContent } from '@components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@components/ui/dialog'
import { Toaster } from '@components/ui/sonner'
import { WEIBO_DEFAULT_HOT_CHANNELS, WEIBO_HOT_CHANNEL_LIMIT, WEIBO_PINNED_HOT_CHANNELS } from '@shared/types/weibo'
import type { WeiboHotChannel } from '@shared/types/weibo'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
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
import { useWeiboFeed } from './hooks/useWeiboFeed'
import { useWeiboGroups } from './hooks/useWeiboGroups'
import { useWeiboProfile } from './hooks/useWeiboProfile'
import { useWeiboTimeline } from './hooks/useWeiboTimeline'
import { WeiboAccountMenu } from './layout/WeiboAccountMenu'
import { WeiboEmoticonPicker } from './layout/WeiboEmoticonPicker'
import { WeiboFeedList } from './layout/WeiboFeedList'
import { WeiboHotRankList } from './layout/WeiboHotRankList'
import { WeiboNav } from './layout/WeiboNav'
import { readCustomGroupId, readHotChannelGid, readWeiboViewLabel, toHotChannelView } from './layout/weiboNavGroups'
import type { WeiboFeedController } from './hooks/useWeiboFeed'
import type { WeiboView } from './layout/weiboNavGroups'
import type { JSX } from 'react'

/** 发布框字数上限：按微博普通正文限制收口，接口接入前先在前端挡住超长输入 */
const POST_MAX_LENGTH = 2000

/** 保存时间展示：仅用于确认「填的是哪一次」，不含 Cookie 任何片段 */
function formatSavedAt(savedAt: string | null): string {
    if (savedAt === null) {
        return '已配置登录 Cookie'
    }
    const date = new Date(savedAt)
    if (Number.isNaN(date.getTime())) {
        return '已配置登录 Cookie'
    }
    return `已配置登录 Cookie · ${format(date, 'yyyy-MM-dd HH:mm')}`
}

export function WeiboPanel(): JSX.Element {
    const theme = useVscodeTheme()
    const {
        state: homeState,
        refresh: refreshHome,
        loadMore: loadMoreHome,
        saveCredential,
        clearCredential,
    } = useWeiboTimeline()
    const [view, setView] = useState<WeiboView>('home.recommend')
    const [isCredentialOpen, setIsCredentialOpen] = useState(false)
    // 设置改为弹窗：不再占用导航视图
    const [isSettingsOpen, setIsSettingsOpen] = useState(false)
    // 删除 Cookie 是破坏性操作：先确认，再交宿主清除
    const [isDeleteOpen, setIsDeleteOpen] = useState(false)
    useHostToast()

    const isConfigured = homeState.credential?.isConfigured ?? false
    const { state: profileState } = useWeiboProfile(isConfigured)
    const { state: groupsState, reload: reloadGroups } = useWeiboGroups({ enabled: isConfigured })
    const timelineListId = groupsState.groups?.timelineListId ?? null
    const timelineFeed = useWeiboFeed({
        source: 'timeline',
        listId: timelineListId,
        enabled: isConfigured && view === 'home.timeline',
    })
    /** 我的分组：自建分组直接进菜单，用 useMemo 稳定引用，避免每轮渲染都重算依赖 */
    const myGroups = useMemo(() => groupsState.groups?.myGroups ?? [], [groupsState.groups])
    /** 频道池：allGroups 的「我的频道 / 频道推荐」，只作候选来源，不直接全量上菜单 */
    const hotChannelPool = useMemo(() => groupsState.groups?.hotChannels ?? [], [groupsState.groups])
    /**
     * 已知频道全集：本地预设在前、上游池补充在后（同 gid 以预设为准，
     * 否则「推荐」会被上游的「热门」标题顶掉）。
     */
    const knownHotChannels = useMemo(() => {
        const extra = hotChannelPool.filter(
            (channel) => !WEIBO_DEFAULT_HOT_CHANNELS.some((preset) => preset.gid === channel.gid),
        )
        return [...WEIBO_DEFAULT_HOT_CHANNELS, ...extra]
    }, [hotChannelPool])
    /**
     * 菜单上的热门频道 gid：会话内状态，初始即默认那 8 个。
     * 关键约束：不能只记「手动补充的」，小时榜等默认可移除项删掉后再加回来也要有位置。
     */
    const [hotChannelGids, setHotChannelGids] = useState<readonly string[]>(() =>
        WEIBO_DEFAULT_HOT_CHANNELS.map((channel) => channel.gid),
    )
    /** 按 gid 顺序还原频道对象：删掉的 gid 不在已知集合里时直接跳过，不会渲染空按钮 */
    const hotChannels = useMemo(
        () =>
            hotChannelGids
                .map((gid) => knownHotChannels.find((channel) => channel.gid === gid))
                .filter((channel): channel is WeiboHotChannel => channel !== undefined),
        [hotChannelGids, knownHotChannels],
    )
    /** 「＋」弹层的候选：已知集合里尚未上菜单的频道（含被移除的默认项） */
    const hotChannelCandidates = useMemo(
        () => knownHotChannels.filter((channel) => !hotChannelGids.includes(channel.gid)),
        [knownHotChannels, hotChannelGids],
    )
    /** 当前热门频道的 gid：视图标识 `hot.<gid>` 还原而来，非热门频道为 null */
    const hotListId = readHotChannelGid(view)
    const hotFeed = useWeiboFeed({
        source: 'hot',
        listId: hotListId,
        enabled: isConfigured && hotListId !== null,
    })
    /** 当前停留的自建分组：从视图标识还原 gid，再回分组集合取标题等信息 */
    const activeGroupId = readCustomGroupId(view)
    const activeGroup = activeGroupId === null ? null : (myGroups.find((group) => group.gid === activeGroupId) ?? null)
    const groupFeed = useWeiboFeed({
        source: 'group',
        listId: activeGroupId,
        enabled: isConfigured && activeGroupId !== null,
    })

    const activeFeed: WeiboFeedController | null =
        view === 'home.timeline'
            ? timelineFeed
            : hotListId !== null
              ? hotFeed
              : activeGroupId === null
                ? null
                : groupFeed
    const isRefreshing = activeFeed === null ? homeState.isRefreshing : activeFeed.state.isRefreshing
    /** 刷新不可用：未配置，以及停在没有信息流的频道（规划中的频道没有可刷新的数据） */
    const isRefreshDisabled = !isConfigured || (activeFeed === null && view !== 'home.recommend')
    /** 个人主页用的 uid：账号信息优先，分组结果兜底 */
    const profileUid = profileState.profile?.id ?? groupsState.groups?.uid ?? null

    /** 添加热门频道：重复或超限一律忽略，加入后直接切到该频道 */
    const handleAddHotChannel = useCallback((gid: string): void => {
        setHotChannelGids((previous) => {
            if (previous.includes(gid)) {
                return previous
            }
            // 上限按菜单总数算
            if (previous.length >= WEIBO_HOT_CHANNEL_LIMIT) {
                return previous
            }
            return [...previous, gid]
        })
        setView(toHotChannelView(gid))
    }, [])

    /**
     * 移除热门频道：固定频道（推荐/实时/同城/榜单）不允许移除 —— 菜单侧已过滤掉入口，这里再兜一次。
     * 关键约束：正停在被移除的频道上时必须切回推荐频道，否则内容区会停在一个已不存在的频道，
     * 菜单里也没有它的入口，用户会以为面板坏了；被移除的默认项会回到候选池，可以再加回来。
     */
    const handleRemoveHotChannel = useCallback((gid: string): void => {
        if (WEIBO_PINNED_HOT_CHANNELS.some((channel) => channel.gid === gid)) {
            return
        }
        setHotChannelGids((previous) => previous.filter((item) => item !== gid))
        const fallback = WEIBO_PINNED_HOT_CHANNELS[0]
        if (fallback === undefined) {
            return
        }
        setView((previous) => (previous === toHotChannelView(gid) ? toHotChannelView(fallback.gid) : previous))
    }, [])

    const handleOpenSettings = useCallback((): void => {
        setIsSettingsOpen(true)
    }, [])

    /** 删除 Cookie：先打开确认框，真正清除在 handleConfirmDelete */
    const handleRequestDelete = useCallback((): void => {
        setIsDeleteOpen(true)
    }, [])

    /**
     * 确认删除：清除后回首页并展开凭证卡。
     * 关键约束：用户下一步多半是重新登录粘贴新 Cookie，留在原视图会看不到配置入口。
     */
    const handleConfirmDelete = useCallback((): void => {
        void clearCredential().then((isCleared) => {
            if (!isCleared) {
                return
            }
            setView('home.recommend')
            setIsCredentialOpen(true)
        })
    }, [clearCredential])

    const collapseCredential = useCallback((): void => {
        setIsCredentialOpen(false)
    }, [])

    const handleRefresh = useCallback((): void => {
        if (activeFeed === null) {
            void refreshHome()
            return
        }
        void activeFeed.refresh()
    }, [activeFeed, refreshHome])

    const handleHomeLoadMore = useCallback((): void => {
        void loadMoreHome()
    }, [loadMoreHome])

    const handleTimelineLoadMore = useCallback((): void => {
        void timelineFeed.loadMore()
    }, [timelineFeed])

    const handleHotLoadMore = useCallback((): void => {
        void hotFeed.loadMore()
    }, [hotFeed])

    const handleGroupLoadMore = useCallback((): void => {
        void groupFeed.loadMore()
    }, [groupFeed])

    /** 重读分组：菜单里的自建分组随之更新，新增或删除分组都会立刻反映 */
    const handleReloadGroups = useCallback((): void => {
        void reloadGroups()
    }, [reloadGroups])

    const openProfile = useCallback(async (uid: string): Promise<void> => {
        try {
            await request('weibo/openPost', { url: `https://weibo.com/u/${uid}` })
        } catch (cause) {
            toastError(cause)
        }
    }, [])

    const handleOpenProfile = useCallback((): void => {
        if (profileUid === null) {
            toast.info('还没有识别到账号：保存 Cookie 后会自动读取')
            return
        }
        void openProfile(profileUid)
    }, [openProfile, profileUid])

    /** 各视图的说明文案：已接入的频道描述取数口径，自建分组说明所在分组，规划中的频道只说明状态 */
    function describeView(): string {
        switch (view) {
            case 'home.recommend':
                return isConfigured
                    ? `${formatSavedAt(homeState.credential?.savedAt ?? null)}：关注时间线只读浏览，图片与视频请打开原文查看。`
                    : '关注时间线依赖网页版登录 Cookie：先登录 weibo.com，再从任意 ajax 请求的请求头复制完整 Cookie。'
            case 'home.timeline':
                return '时间线：默认分组「最新微博」的 list_id，按增量刷新与游标翻页读取。'
            default:
                if (hotListId !== null) {
                    return `热门：${readWeiboViewLabel(view, myGroups, hotChannels)}，首屏 10 条，翻页沿用上游 max_id。`
                }
                return activeGroupId === null
                    ? `${readWeiboViewLabel(view, myGroups, hotChannels)}：频道已在菜单规划中，数据接口尚未接入。`
                    : `分组：${activeGroup?.title ?? '该分组'} 的信息流，翻页只在该分组内生效。`
        }
    }

    /** 未配置凭证时的统一引导：所有信息流共用同一份说明 */
    function renderNeedCredential(): JSX.Element {
        return (
            <StateEmpty
                className="py-8"
                icon={Inbox}
                title="还没有配置微博 Cookie"
                description="在「设置」里保存登录后的 Cookie 即可读取信息流：先登录 weibo.com，再复制任意 ajax 请求头里的完整 Cookie。"
            >
                <Button size="sm" variant="outline" onClick={handleOpenSettings}>
                    去设置
                </Button>
            </StateEmpty>
        )
    }

    /** 首页：发布框（占位）+ 凭证卡（按需）+ 关注时间线 */
    function renderHome(): JSX.Element {
        const shouldShowCredential = !homeState.isLoading && (isCredentialOpen || !isConfigured)
        return (
            <>
                <ComposerCard isEnabled={isConfigured} />
                {shouldShowCredential ? (
                    <CredentialCard
                        isConfigured={isConfigured}
                        isSaving={homeState.isSavingCredential}
                        onSave={saveCredential}
                        onClear={clearCredential}
                        onCollapse={collapseCredential}
                        canCollapse={isConfigured}
                    />
                ) : null}
                <WeiboFeedList
                    posts={homeState.posts}
                    isLoading={homeState.isLoading}
                    isLoadingMore={homeState.isLoadingMore}
                    hasMore={homeState.hasMore}
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
                            <StateEmpty
                                className="py-8"
                                icon={Inbox}
                                title="还没有配置微博 Cookie"
                                description="按上方步骤复制登录后的 Cookie 并保存，即可读取关注时间线。"
                            />
                        )
                    }
                    onLoadMore={handleHomeLoadMore}
                />
            </>
        )
    }

    /** 时间线：默认分组的最新微博，list_id 由分组结果给出 */
    function renderTimelineFeed(): JSX.Element {
        if (!isConfigured) {
            return renderNeedCredential()
        }
        if (timelineListId === null) {
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
            <WeiboFeedList
                posts={timelineFeed.state.posts}
                isLoading={timelineFeed.state.isLoading || !timelineFeed.state.hasLoaded}
                isLoadingMore={timelineFeed.state.isLoadingMore}
                hasMore={timelineFeed.state.hasMore}
                emptyTitle="时间线没有内容"
                emptyDescription={timelineFeed.state.errorMessage ?? '默认分组近期没有更新，稍后刷新一次再试。'}
                onLoadMore={handleTimelineLoadMore}
            />
        )
    }

    /** 热门：固定推荐频道，首屏 10 条 */
    function renderHotFeed(): JSX.Element {
        if (!isConfigured) {
            return renderNeedCredential()
        }
        return (
            <WeiboFeedList
                posts={hotFeed.state.posts}
                isLoading={hotFeed.state.isLoading || !hotFeed.state.hasLoaded}
                isLoadingMore={hotFeed.state.isLoadingMore}
                hasMore={hotFeed.state.hasMore}
                emptyTitle="热门没有内容"
                emptyDescription={hotFeed.state.errorMessage ?? '推荐频道暂时返回空页，稍后刷新一次再试。'}
                onLoadMore={handleHotLoadMore}
            />
        )
    }

    /**
     * 自建分组：菜单里直接点分组名进来，按该分组的 list_id 取信息流，翻页只在该分组内生效。
     * 关键约束：分组结果还没到（例如刚从其他设备新建）时先给加载态，避免误报「没有内容」。
     */
    function renderGroupFeed(): JSX.Element {
        if (!isConfigured) {
            return renderNeedCredential()
        }
        if (groupsState.isLoading && activeGroup === null) {
            return <StateEmpty className="py-8" title="正在读取分组..." isLoading />
        }
        return (
            <WeiboFeedList
                posts={groupFeed.state.posts}
                isLoading={groupFeed.state.isLoading || !groupFeed.state.hasLoaded}
                isLoadingMore={groupFeed.state.isLoadingMore}
                hasMore={groupFeed.state.hasMore}
                emptyTitle={`「${activeGroup?.title ?? '该分组'}」没有内容`}
                emptyDescription={groupFeed.state.errorMessage ?? '分组近期没有更新，稍后刷新一次再试。'}
                onLoadMore={handleGroupLoadMore}
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
        switch (view) {
            case 'home.recommend':
                return renderHome()
            case 'home.timeline':
                return renderTimelineFeed()
            default:
                // 热门各频道共用一套渲染（只是 group_id 不同），自建分组与规划中的频道才继续分流
                if (hotListId !== null) {
                    return renderHotFeed()
                }
                return activeGroupId === null ? renderPlannedView() : renderGroupFeed()
        }
    }

    return (
        <>
            {/* AppPage 按 h-full 撑满，webview 的 #root 没有高度基准，不给视口高度顶栏会随 body 一起滚走
                （与 WorkflowScreen / dashboardScreen 同形） */}
            <div className="flex h-screen min-h-0 flex-col">
                <AppPage>
                    <AppHeader>
                        <AppTitle>微博</AppTitle>
                        <AppAction>
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={handleRefresh}
                                isLoading={isRefreshing}
                                disabled={isRefreshDisabled}
                                tooltip="增量刷新：只取上次之后的新内容"
                            >
                                <RefreshCw className="size-3.5" aria-hidden="true" />
                                刷新
                            </Button>
                            <WeiboAccountMenu
                                isConfigured={isConfigured}
                                profile={profileState.profile}
                                avatarDataUrl={profileState.avatarDataUrl}
                                isProfileLoading={profileState.isLoading}
                                onOpenProfile={handleOpenProfile}
                                onOpenSettings={handleOpenSettings}
                                onDeleteCredential={handleRequestDelete}
                            />
                        </AppAction>
                        <AppDescription>{describeView()}</AppDescription>
                        <AppMenu>
                            <WeiboNav
                                active={view}
                                onSelect={setView}
                                customGroups={myGroups}
                                hotChannels={hotChannels}
                                hotChannelCandidates={hotChannelCandidates}
                                onAddHotChannel={handleAddHotChannel}
                                onRemoveHotChannel={handleRemoveHotChannel}
                            />
                        </AppMenu>
                    </AppHeader>

                    <AppContent isScrollable className="gap-3 p-3">
                        <div className="mx-auto flex w-full max-w-5xl items-start justify-center gap-3 py-1">
                            <div className="flex min-w-0 max-w-2xl flex-1 flex-col gap-3">{renderContent()}</div>
                            {/* 右侧热搜榜：容器够宽才出现，窄面板让位给正文列表。
                                三件事缺一不可：@3xl:block 让 hidden 在该档恢复显示、
                                self-start 避免被拉伸到内容高度（拉满后 sticky 没有可粘的行程）、
                                sticky + top 让它在 AppContent 的滚动区里钉住不随列表滚走 */}
                            <aside className="hidden w-80 shrink-0 @3xl:sticky @3xl:top-0 @3xl:block @3xl:self-start">
                                <WeiboHotRankList isEnabled={isConfigured} />
                            </aside>
                        </div>
                    </AppContent>
                </AppPage>
            </div>
            <SettingsDialog
                isOpen={isSettingsOpen}
                onOpenChange={setIsSettingsOpen}
                isConfigured={isConfigured}
                isSaving={homeState.isSavingCredential}
                onSave={saveCredential}
                onClear={clearCredential}
                onCollapse={collapseCredential}
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

interface SettingsDialogProps {
    isOpen: boolean
    onOpenChange: (isOpen: boolean) => void
    isConfigured: boolean
    isSaving: boolean
    /** 返回是否保存成功：失败时凭证卡保留输入，避免用户重贴一遍 */
    onSave: (cookie: string) => Promise<boolean>
    onClear: () => Promise<boolean>
    /** 保存成功后收起首页的凭证卡：设置弹窗里的卡片本身不可收起 */
    onCollapse: () => void
}

/**
 * 设置弹窗：凭证卡常驻 + 各入口取数口径。
 * 复用约定：外壳取 @components/ui/dialog（Title / Description 必填），凭证卡复用同文件的 CredentialCard。
 * 关键约束：内容超出视口时在弹窗内滚动，不撑高页面；保存成功由 CredentialCard 回调收起首页的凭证卡。
 */
function SettingsDialog({
    isOpen,
    onOpenChange,
    isConfigured,
    isSaving,
    onSave,
    onClear,
    onCollapse,
}: SettingsDialogProps): JSX.Element {
    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[calc(100vh-4rem)] flex-col gap-3 sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle className="text-lg">设置</DialogTitle>
                    <DialogDescription>登录 Cookie 只写入本机密钥库，不进日志、不进设置文件。</DialogDescription>
                </DialogHeader>
                <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
                    <CredentialCard
                        isConfigured={isConfigured}
                        isSaving={isSaving}
                        onSave={onSave}
                        onClear={onClear}
                        onCollapse={onCollapse}
                        canCollapse={false}
                    />
                    <Card>
                        <CardContent className="flex flex-col gap-2">
                            <h2 className="font-medium">各入口的取数口径</h2>
                            <ul className="list-disc space-y-1 pl-5 text-muted-foreground text-xs">
                                <li>首页：unreadfriendstimeline，增量刷新只取上次之后的新微博。</li>
                                <li>时间线：friendstimeline，list_id 取默认分组里「最新微博」的 gid。</li>
                                <li>热门：hottimeline，固定频道 102803，首屏 10 条。</li>
                                <li>分组：allGroups 取「我的分组」，选中后走 groupstimeline 拉该分组。</li>
                            </ul>
                            <p className="text-muted-foreground text-xs">
                                所有接口都是网页端内部 ajax：改版或风控升级后可能失效，届时重新粘贴 Cookie
                                或降低刷新频率再试。
                            </p>
                        </CardContent>
                    </Card>
                </div>
            </DialogContent>
        </Dialog>
    )
}

interface ComposerCardProps {
    /** 是否已配置凭证：表情配置接口同样依赖登录 Cookie */
    isEnabled: boolean
}

/** 微博发布框：受控编辑 + 表情插入 + 字数与发布按钮，占位阶段不落盘、不请求宿主 */
function ComposerCard({ isEnabled }: ComposerCardProps): JSX.Element {
    const [draft, setDraft] = useState('')
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    // 插入后待恢复的光标位置：受控 textarea 的值更新后由 effect 落回选区
    const pendingCaretRef = useRef<number | null>(null)
    const canPublish = draft.trim().length > 0

    useEffect(() => {
        const caret = pendingCaretRef.current
        const textarea = textareaRef.current
        if (caret === null || textarea === null) {
            return
        }
        pendingCaretRef.current = null
        textarea.focus()
        textarea.setSelectionRange(caret, caret)
    }, [draft])

    const handleInsertEmoticon = useCallback(
        (phrase: string): void => {
            const textarea = textareaRef.current
            const start = textarea?.selectionStart ?? draft.length
            const end = textarea?.selectionEnd ?? draft.length
            const nextDraft = draft.slice(0, start) + phrase + draft.slice(end)
            if (nextDraft.length > POST_MAX_LENGTH) {
                toast.info(`正文最多 ${POST_MAX_LENGTH} 字，无法再插入表情`)
                return
            }
            pendingCaretRef.current = start + phrase.length
            setDraft(nextDraft)
        },
        [draft],
    )

    /** 发布占位：接口未接入，先给出明确反馈，避免点了没反应 */
    function handlePublish(): void {
        if (!canPublish) {
            return
        }
        toast.info('发布能力尚未接入：当前内容只停留在编辑框内')
    }

    return (
        <Card>
            <CardContent className="flex flex-col gap-2">
                <textarea
                    ref={textareaRef}
                    value={draft}
                    rows={4}
                    placeholder="分享你的新鲜事…"
                    aria-label="微博正文"
                    maxLength={POST_MAX_LENGTH}
                    onChange={(event) => {
                        setDraft(event.target.value)
                    }}
                    className="min-h-24 w-full resize-y bg-transparent text-sm leading-relaxed outline-none placeholder:text-muted-foreground"
                />
                <div className="flex items-center justify-between gap-2 border-t pt-2">
                    <div className="flex items-center gap-1">
                        <WeiboEmoticonPicker isEnabled={isEnabled} onSelect={handleInsertEmoticon} />
                        <span className="text-muted-foreground text-xs tabular-nums">
                            {draft.length} / {POST_MAX_LENGTH}
                        </span>
                    </div>
                    <Button variant="primary" disabled={!canPublish} onClick={handlePublish}>
                        发布
                    </Button>
                </div>
            </CardContent>
        </Card>
    )
}

interface CredentialCardProps {
    isConfigured: boolean
    isSaving: boolean
    /** 返回是否保存成功：失败时保留输入，避免用户重贴一遍 */
    onSave: (cookie: string) => Promise<boolean>
    onClear: () => Promise<boolean>
    onCollapse: () => void
    canCollapse: boolean
}

/**
 * Cookie 配置卡：说明获取路径与存储方式，提供保存与清除。
 * 关键约束：输入为普通文本框但不回填历史值，保存成功后由调用方收起。
 */
function CredentialCard({
    isConfigured,
    isSaving,
    onSave,
    onClear,
    onCollapse,
    canCollapse,
}: CredentialCardProps): JSX.Element {
    const [cookieInput, setCookieInput] = useState('')

    const handleSave = useCallback((): void => {
        void onSave(cookieInput).then((isSaved) => {
            if (!isSaved) {
                return
            }
            setCookieInput('')
            onCollapse()
        })
    }, [cookieInput, onCollapse, onSave])

    const handleClear = useCallback((): void => {
        void onClear()
    }, [onClear])

    return (
        <Card>
            <CardContent className="flex flex-col gap-2">
                <h2 className="font-medium">微博登录 Cookie</h2>
                <ol className="list-decimal space-y-1 pl-5 text-muted-foreground text-xs">
                    <li>在浏览器登录 weibo.com，打开开发者工具的「网络」面板。</li>
                    <li>刷新页面，任选一条 weibo.com/ajax 开头的请求，复制请求头里的完整 Cookie。</li>
                    <li>粘贴到下方并保存：Cookie 只写入本机 SecretStorage（系统加密），不进日志、不进设置文件。</li>
                </ol>
                <textarea
                    className="h-20 w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring"
                    placeholder="SUB=...; SUBP=...; 其它 Cookie 一并保留"
                    value={cookieInput}
                    spellCheck={false}
                    onChange={(event) => {
                        setCookieInput(event.target.value)
                    }}
                />
                <div className="flex items-center gap-2">
                    <Button
                        size="sm"
                        onClick={handleSave}
                        isLoading={isSaving}
                        disabled={cookieInput.trim().length === 0}
                    >
                        保存
                    </Button>
                    {isConfigured ? (
                        <Button size="sm" variant="ghost" onClick={handleClear} disabled={isSaving}>
                            清除
                        </Button>
                    ) : null}
                    {canCollapse ? (
                        <Button size="sm" variant="ghost" className="ml-auto" onClick={onCollapse}>
                            收起
                        </Button>
                    ) : null}
                </div>
                <p className="text-muted-foreground text-xs">
                    提示：Cookie 等同于账号登录态，请勿分享；该接口是网页端内部 ajax，改版后可能失效。
                </p>
            </CardContent>
        </Card>
    )
}
