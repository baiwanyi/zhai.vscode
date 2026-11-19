/**
 * 微博面板：编辑区独立页，顶部固定菜单切换首页 / 时间线 / 热门 / 分组与设置。
 * 复用约定：页面骨架取 @webview/components/AppPage，卡片取 @components/ui/card，
 * 取数状态分别来自 hooks 下的关注时间线、信息流与分组控制器，
 * 列表渲染统一交给 components/WeiboFeedList，单条仍是 components/WeiboPostCard，
 * 空态复用 StateEmpty，操作反馈用 sonner（Toaster 主题取 useVscodeTheme）。
 * 关键约束：未配置 Cookie 时任何信息流都不发请求，只给可执行的获取步骤；
 * Cookie 输入框不回显已保存值，保存成功后清空并收起，明文只存在于输入瞬间；
 * 时间线、热门与分组都是只读浏览，发布框仍是占位（写接口不在本次范围）；
 * 个人主页按账号 uid 拼 weibo.com 地址交给宿主打开，取不到 uid 时禁用而不是拼空地址。
 */
import { format } from 'date-fns'
import { Inbox, RefreshCw, Settings2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent } from '@components/ui/card'
import { Toaster } from '@components/ui/sonner'
import type { WeiboGroupItem } from '@shared/types/weibo'
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
import { WeiboFeedList } from './components/WeiboFeedList'
import { WeiboGroupList } from './components/WeiboGroupList'
import { WeiboNav } from './components/WeiboNav'
import { useWeiboFeed } from './hooks/useWeiboFeed'
import { useWeiboGroups } from './hooks/useWeiboGroups'
import { useWeiboTimeline } from './hooks/useWeiboTimeline'
import type { WeiboView } from './components/WeiboNav'
import type { WeiboFeedController } from './hooks/useWeiboFeed'
import type { JSX } from 'react'

/** 发布框字数上限：按微博普通正文限制收口，接口接入前先在前端挡住超长输入 */
const POST_MAX_LENGTH = 2000

/** 热门频道 id：网页端「推荐」频道固定用它作分组与容器标识 */
const HOT_FEED_LIST_ID = '102803'

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
    const [view, setView] = useState<WeiboView>('home')
    const [isCredentialOpen, setIsCredentialOpen] = useState(false)
    const [selectedGroup, setSelectedGroup] = useState<WeiboGroupItem | null>(null)
    useHostToast()

    const isConfigured = homeState.credential?.isConfigured ?? false
    const { state: groupsState, reload: reloadGroups } = useWeiboGroups({ enabled: isConfigured })
    const timelineListId = groupsState.groups?.timelineListId ?? null
    const timelineFeed = useWeiboFeed({
        source: 'timeline',
        listId: timelineListId,
        enabled: isConfigured && view === 'timeline',
    })
    const hotFeed = useWeiboFeed({
        source: 'hot',
        listId: HOT_FEED_LIST_ID,
        enabled: isConfigured && view === 'hot',
    })
    const groupFeed = useWeiboFeed({
        source: 'group',
        listId: selectedGroup?.gid ?? null,
        enabled: isConfigured && view === 'groups' && selectedGroup !== null,
    })

    const activeFeed: WeiboFeedController | null =
        view === 'timeline' ? timelineFeed : view === 'hot' ? hotFeed : view === 'groups' ? groupFeed : null
    const isRefreshing = activeFeed === null ? homeState.isRefreshing : activeFeed.state.isRefreshing
    const isRefreshDisabled = !isConfigured || (view === 'groups' && selectedGroup === null)
    const profileUid = groupsState.groups?.uid ?? null

    const toggleCredential = useCallback((): void => {
        setIsCredentialOpen((previous) => !previous)
    }, [])

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

    const handleReloadGroups = useCallback((): void => {
        void reloadGroups()
    }, [reloadGroups])

    const handleSelectGroup = useCallback((group: WeiboGroupItem): void => {
        setSelectedGroup(group)
    }, [])

    const handleBackToGroups = useCallback((): void => {
        setSelectedGroup(null)
    }, [])

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

    /** 各视图的说明文案：首页沿用凭证提示，其余只描述当前流的口径 */
    function describeView(): string {
        switch (view) {
            case 'home':
                return isConfigured
                    ? `${formatSavedAt(homeState.credential?.savedAt ?? null)}：关注时间线只读浏览，图片与视频请打开原文查看。`
                    : '关注时间线依赖网页版登录 Cookie：先登录 weibo.com，再从任意 ajax 请求的请求头复制完整 Cookie。'
            case 'timeline':
                return '时间线：默认分组「最新微博」的 list_id，按增量刷新与游标翻页读取。'
            case 'hot':
                return '热门：网页端推荐频道（102803），首屏 10 条，翻页沿用上游 max_id。'
            case 'groups':
                return selectedGroup === null
                    ? '分组：从「我的分组」中选择一个分组查看。'
                    : `分组：${selectedGroup.title} 的信息流。`
            case 'settings':
                return '设置：登录 Cookie 只写入本机 SecretStorage（系统加密），不进日志、不进设置文件。'
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
                <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                        setView('settings')
                    }}
                >
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
                <ComposerCard />
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

    /** 分组：先列「我的分组」，选中后按该分组 list_id 取信息流 */
    function renderGroups(): JSX.Element {
        if (!isConfigured) {
            return renderNeedCredential()
        }
        if (selectedGroup === null) {
            return (
                <WeiboGroupList
                    groups={groupsState.groups?.myGroups ?? []}
                    isLoading={groupsState.isLoading}
                    errorMessage={groupsState.errorMessage}
                    onSelect={handleSelectGroup}
                    onReload={handleReloadGroups}
                />
            )
        }
        return (
            <>
                <div className="flex items-center gap-2">
                    <Button size="sm" variant="ghost" onClick={handleBackToGroups}>
                        返回分组
                    </Button>
                    <span className="truncate text-muted-foreground text-xs">{selectedGroup.title}</span>
                </div>
                <WeiboFeedList
                    posts={groupFeed.state.posts}
                    isLoading={groupFeed.state.isLoading || !groupFeed.state.hasLoaded}
                    isLoadingMore={groupFeed.state.isLoadingMore}
                    hasMore={groupFeed.state.hasMore}
                    emptyTitle="这个分组没有内容"
                    emptyDescription={groupFeed.state.errorMessage ?? '分组近期没有更新，稍后刷新一次再试。'}
                    onLoadMore={handleGroupLoadMore}
                />
            </>
        )
    }

    /** 设置：凭证卡常驻，附读取口径与失效处置说明 */
    function renderSettings(): JSX.Element {
        return (
            <>
                <CredentialCard
                    isConfigured={isConfigured}
                    isSaving={homeState.isSavingCredential}
                    onSave={saveCredential}
                    onClear={clearCredential}
                    onCollapse={collapseCredential}
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
            </>
        )
    }

    function renderContent(): JSX.Element {
        switch (view) {
            case 'home':
                return renderHome()
            case 'timeline':
                return renderTimelineFeed()
            case 'hot':
                return renderHotFeed()
            case 'groups':
                return renderGroups()
            case 'settings':
                return renderSettings()
        }
    }

    return (
        <AppPage>
            <AppHeader>
                <AppTitle>微博</AppTitle>
                <AppAction>
                    {view === 'settings' ? null : (
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
                    )}
                    {view === 'home' ? (
                        <Button size="sm" variant="ghost" onClick={toggleCredential} tooltip="更新或清除登录 Cookie">
                            <Settings2 className="size-3.5" aria-hidden="true" />
                            Cookie
                        </Button>
                    ) : null}
                </AppAction>
                <AppDescription>{describeView()}</AppDescription>
                <AppMenu>
                    <WeiboNav
                        active={view}
                        onSelect={setView}
                        onOpenProfile={handleOpenProfile}
                        isProfileDisabled={profileUid === null}
                    />
                </AppMenu>
            </AppHeader>

            <AppContent isScrollable className="gap-3 pb-4">
                <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">{renderContent()}</div>
            </AppContent>

            <Toaster theme={theme} />
        </AppPage>
    )
}

/** 微博发布框：受控编辑器 + 字数与发布按钮，占位阶段不落盘、不请求宿主 */
function ComposerCard(): JSX.Element {
    const [draft, setDraft] = useState('')
    const canPublish = draft.trim().length > 0

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
                    <span className="text-muted-foreground text-xs tabular-nums">
                        {draft.length} / {POST_MAX_LENGTH}
                    </span>
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
