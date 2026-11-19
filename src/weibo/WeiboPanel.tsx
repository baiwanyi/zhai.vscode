/**
 * 微博面板：编辑区独立页，上方微博发布框（占位），下方关注时间线（网页版 ajax 接口）。
 * 复用约定：页面骨架取 @webview/components/AppPage，卡片取 @components/ui/card，
 * 取数状态全部来自 hooks/useWeiboTimeline，单条渲染交给 components/WeiboPostCard，
 * 空态与加载态复用 StateEmpty，操作反馈用 sonner（Toaster 主题取 useVscodeTheme）。
 * 关键约束：未配置 Cookie 时不发任何网络请求，只给可执行的获取步骤；
 * Cookie 输入框不回显已保存值，保存成功后清空并收起，明文只存在于输入瞬间；
 * 时间线为只读，发布框仍是占位（写接口不在本次范围）；到底后不再渲染「加载更多」，
 * 防止反复点击打出空请求。
 */
import { format } from 'date-fns'
import { Inbox, RefreshCw, Settings2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent } from '@components/ui/card'
import { Toaster } from '@components/ui/sonner'
import { AppAction, AppContent, AppDescription, AppHeader, AppPage, AppTitle } from '@webview/components/AppPage'
import { Button } from '@webview/components/Button'
import { StateEmpty } from '@webview/components/StateEmpty'
import { useHostToast } from '@webview/hooks/useHostToast'
import { useVscodeTheme } from '@webview/hooks/useVscodeTheme'
import { WeiboPostCard } from './components/WeiboPostCard'
import { useWeiboTimeline } from './hooks/useWeiboTimeline'
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
    const { state, refresh, loadMore, saveCredential, clearCredential } = useWeiboTimeline()
    const [isCredentialOpen, setIsCredentialOpen] = useState(false)
    useHostToast()

    const isConfigured = state.credential?.isConfigured ?? false
    const shouldShowCredential = !state.isLoading && (isCredentialOpen || !isConfigured)

    const toggleCredential = useCallback((): void => {
        setIsCredentialOpen((previous) => !previous)
    }, [])

    const collapseCredential = useCallback((): void => {
        setIsCredentialOpen(false)
    }, [])

    const handleRefresh = useCallback((): void => {
        void refresh()
    }, [refresh])

    const handleLoadMore = useCallback((): void => {
        void loadMore()
    }, [loadMore])

    /** 时间线主体：加载态 / 未配置 / 空列表 / 列表 + 加载更多 */
    function renderTimeline(): JSX.Element {
        if (state.isLoading) {
            return <StateEmpty className="py-8" title="正在读取关注时间线..." isLoading />
        }
        if (!isConfigured) {
            return (
                <StateEmpty
                    className="py-8"
                    icon={Inbox}
                    title="还没有配置微博 Cookie"
                    description="按上方步骤复制登录后的 Cookie 并保存，即可读取关注时间线。"
                />
            )
        }
        if (state.posts.length === 0) {
            return (
                <StateEmpty
                    className="py-8"
                    icon={Inbox}
                    title="时间线没有内容"
                    description={
                        state.errorMessage ?? '可能是关注列表近期没有更新，也可能是接口返回了空页：稍后刷新一次再试。'
                    }
                >
                    <Button size="sm" variant="outline" onClick={handleRefresh}>
                        刷新
                    </Button>
                </StateEmpty>
            )
        }
        return (
            <>
                {state.posts.map((post) => (
                    <WeiboPostCard key={post.id} post={post} />
                ))}
                <div className="flex justify-center py-2">
                    {state.hasMore ? (
                        <Button size="sm" variant="outline" onClick={handleLoadMore} isLoading={state.isLoadingMore}>
                            加载更多
                        </Button>
                    ) : (
                        <span className="text-muted-foreground text-xs">已经到底了</span>
                    )}
                </div>
            </>
        )
    }

    return (
        <AppPage>
            <AppHeader>
                <AppTitle>微博</AppTitle>
                <AppAction>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={handleRefresh}
                        isLoading={state.isRefreshing}
                        disabled={!isConfigured}
                        tooltip="增量刷新：只取上次之后的新微博"
                    >
                        <RefreshCw className="size-3.5" aria-hidden="true" />
                        刷新
                    </Button>
                    <Button size="sm" variant="ghost" onClick={toggleCredential} tooltip="更新或清除登录 Cookie">
                        <Settings2 className="size-3.5" aria-hidden="true" />
                        Cookie
                    </Button>
                </AppAction>
                <AppDescription>
                    {isConfigured
                        ? `${formatSavedAt(state.credential?.savedAt ?? null)}：关注时间线只读浏览，图片与视频请打开原文查看。`
                        : '关注时间线依赖网页版登录 Cookie：先登录 weibo.com，再从任意 ajax 请求的请求头复制完整 Cookie。'}
                </AppDescription>
            </AppHeader>

            <AppContent isScrollable className="gap-3 pb-4">
                <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
                    <ComposerCard />
                    {shouldShowCredential ? (
                        <CredentialCard
                            isConfigured={isConfigured}
                            isSaving={state.isSavingCredential}
                            onSave={saveCredential}
                            onClear={clearCredential}
                            onCollapse={collapseCredential}
                            canCollapse={isConfigured}
                        />
                    ) : null}
                    {renderTimeline()}
                </div>
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
