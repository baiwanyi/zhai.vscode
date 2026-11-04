/**
 * 在线图库页：Unsplash 搜索与「已下载」两个视图，点击即把图片插到当前 Markdown 光标处。
 * 独立常驻分区，入口在侧栏导航（品牌图标取自 resources/icons/unsplash.svg），与媒体并列。
 * 复用约定：外壳取 @webview/components/AppPage，筛选行、话题标签与配额徽标沿用原组件；
 * 两个视图的列表都走统一图片列表 ImageList，条目经 imageListAdapters 映射，年月取 hooks/mediaMonth，
 * 已下载的分批取 useImageListPaging，搜索侧仍由 useStockPhotos 持有远端分页与配额上限。
 * 关键约束：默认停在搜索——已下载是二级视图，搜索面板常驻挂载、切到已下载只做隐藏，
 * 回来时不丢搜索词也不重复消耗配额；未配置密钥时不发任何请求、先给引导空态；
 * 插入成功只做局部插卡，删除走二次确认；密钥明文只在弹窗输入期间存在，保存后立即丢弃。
 */
import {
    ChevronLeft,
    CloudDownload,
    ImageIcon,
    ImageOff,
    KeyRound,
    MoreHorizontal,
    RotateCw,
    Search,
    Trash2,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@components/ui/dropdown-menu'
import type { StockLocalPhoto, StockPhoto } from '@shared/types/stock'
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
import { ConfirmDialog } from '@webview/components/ConfirmDialog'
import { SegmentedRail } from '@webview/components/SegmentedRail'
import type { SegmentedRailItem } from '@webview/components/SegmentedRail'
import { groupByMonth, toMonthOptions } from './hooks/mediaMonth'
import { useImageListPaging } from './hooks/useImageListPaging'
import { useStockDelete } from './hooks/useStockDelete'
import { useStockDownloaded } from './hooks/useStockDownloaded'
import { useStockInsert } from './hooks/useStockInsert'
import { useStockPhotos } from './hooks/useStockPhotos'
import { useStockStatus } from './hooks/useStockStatus'
import { ImageList } from './layout/imageList/ImageList'
import { toImageListGroups, toStockLocalItem, toStockPhotoItem } from './layout/imageList/imageListAdapters'
import { MonthSelect } from './layout/MonthSelect'
import { ScrollRail } from './layout/ScrollRail'
import { StockFilterBar } from './layout/StockFilterBar'
import { StockKeyDialog } from './layout/StockKeyDialog'
import { StockQuotaBadges } from './layout/StockQuotaBadges'
import { TOPIC_TAB_ITEMS, toStockTopic, toTopicTabValue } from './layout/stockTopics'
import type { ImageListAction, ImageListItem, ImageListStates } from './layout/imageList/imageListModel'
import type { JSX } from 'react'

/** 两个视图：搜索是首页，已下载是二级视图（进入后标题行左侧给返回） */
type StockView = 'search' | 'downloaded'

interface TopicTabRailProps {
    /** 标签清单：由调用方注入，壳本身不认识具体话题 */
    items: readonly SegmentedRailItem<string>[]
    /** 当前选中的标签值：推荐位用 RECOMMEND_TOPIC 表达 */
    value: string
    onChange: (value: string) => void
}

/**
 * 话题标签行：内容胶水——滑动与两端箭头交给 ScrollRail，话题清单由调用方注入。
 * 关键约束：本组件不认识具体话题、也不做滚动测量；「推荐」与协议 null 的折算在上层完成。
 */
function TopicTabRail({ items, value, onChange }: TopicTabRailProps): JSX.Element {
    return (
        <ScrollRail ariaLabel="图库话题" activeValue={value}>
            <SegmentedRail
                items={items}
                ariaLabel="图库话题"
                variant="chip"
                size="sm"
                isWrapped={false}
                value={value}
                onChange={onChange}
            />
        </ScrollRail>
    )
}

/** 已下载列表状态位：首屏骨架 + 空库引导 */
const LOCAL_STATES: ImageListStates = {
    loadingMode: 'skeleton',
    empty: {
        title: '还没有下载过图片',
        description: '切到「搜索」找一张，插入后就会出现在这里，之后再用不需要联网。',
        icon: ImageIcon,
    },
}

export function WorkflowStock(): JSX.Element {
    const { status, reload: reloadStatus, saveKey } = useStockStatus()
    const { items, months, total, isLoading, month, setMonth, reload, remove, prepend } = useStockDownloaded()
    const [view, setView] = useState<StockView>('search')
    const [isKeyOpen, setIsKeyOpen] = useState(false)

    const isDownloadedView = view === 'downloaded'
    const isConfigured = status?.configured === true
    /** 搜索状态放在页面层：页头的标签行与结果区共用同一份，切话题不必再往下透传 */
    const photos = useStockPhotos({ isEnabled: isConfigured })

    const { insertingId, failedId, insert } = useStockInsert({
        onInserted: (id, result) => {
            if (result.path !== undefined && result.url !== undefined) {
                prepend(id, result.path, result.url)
            }
            void reloadStatus()
        },
    })

    /** 月份下拉选项：复用媒体页的聚合口径，全部月份排首位 */
    const monthOptions = useMemo(() => toMonthOptions(months, total), [months, total])

    /** 搜索结果：插入中、失败与并发禁用折算成统一条目的运行态 */
    const searchItems = useMemo<ImageListItem<StockPhoto>[]>(
        () =>
            photos.items.map((photo) => {
                const isBusy = insertingId === photo.id
                return toStockPhotoItem(photo, {
                    isBusy,
                    isFailed: failedId === photo.id,
                    isDisabled: insertingId !== null && !isBusy,
                })
            }),
        [failedId, insertingId, photos.items],
    )

    /** 已下载：按月分组后走统一分批，滚动到底自动续放，不限页数 */
    const localGroups = useMemo(() => groupByMonth(items), [items])
    const {
        visibleGroups,
        hasMore: hasLocalMore,
        loadMore: loadLocalMore,
    } = useImageListPaging({ groups: localGroups, signature: month ?? 'all' })
    const localListGroups = useMemo(
        () =>
            toImageListGroups(visibleGroups, (photo: StockLocalPhoto) => {
                const isBusy = insertingId === photo.id
                return toStockLocalItem(photo, {
                    isBusy,
                    isFailed: failedId === photo.id,
                    isDisabled: insertingId !== null && !isBusy,
                })
            }),
        [failedId, insertingId, visibleGroups],
    )

    /** 刷新：两个视图的数据一起换，状态顺带更新配额与目标 */
    function refresh(): void {
        void reload()
        void reloadStatus()
    }

    /** 切话题：推荐位折算回 null，切话题会清空搜索词（由 useStockPhotos 负责） */
    function handleTopicChange(value: string): void {
        photos.setTopic(toStockTopic(value))
    }

    async function handleSaveKey(accessKey: string): Promise<boolean> {
        const isSaved = await saveKey(accessKey)
        if (isSaved) {
            // 保存密钥只影响配额状态：已下载列表与密钥无关，不必跟着重拉
            void reloadStatus()
        }
        return isSaved
    }

    /** 删除确认：状态机在 useStockDelete 里，真正的删除由 useStockDownloaded 完成并局部移除条目 */
    const deletion = useStockDelete({
        remove,
        onRemoved: () => {
            void reloadStatus()
        },
    })

    /** 搜索卡片的角标动作：缩略图缺失时才出现「重试」 */
    const searchActions: ImageListAction<StockPhoto>[] = [
        {
            key: 'retry-thumb',
            label: '重新获取缩略图',
            icon: RotateCw,
            text: '重试',
            variant: 'secondary',
            placement: 'corner',
            isVisible: (item) => item.src === null,
            onTrigger: (item) => photos.retryThumb(item.source.id),
        },
    ]

    /** 已下载卡片的删除：本处只上报意图，二次确认由页面负责 */
    const localActions: ImageListAction<StockLocalPhoto>[] = [
        {
            key: 'delete',
            label: '删除这张图片',
            icon: Trash2,
            variant: 'destructive',
            placement: 'corner',
            onTrigger: (item) => deletion.request(item.source),
        },
    ]

    /** 搜索区状态：未配置先给引导，冷却与限流错误由 error 态呈现「多久后恢复」 */
    const searchStates: ImageListStates = {
        loadingMode: 'skeleton',
        emptyClassName: isConfigured ? 'py-8' : 'flex-1 justify-center',
        empty: isConfigured
            ? {
                  title: '没有匹配的图片',
                  description:
                      photos.topic === null
                          ? '换个关键词试试，Unsplash 以英文内容为主。'
                          : '这个话题下暂时没有图片，换个话题或直接搜索试试。',
                  icon: Search,
              }
            : {
                  title: '还没有配置 Unsplash',
                  description:
                      '填写 Access Key 后即可搜索图库。图片会下载到文档保存目录的 unsplash 目录，之后可离线复用。',
                  icon: KeyRound,
                  action: <Button onClick={() => setIsKeyOpen(true)}>配置密钥</Button>,
              },
        error: {
            title: '没能取到图片',
            icon: ImageOff,
            action: (
                <Button variant="outline" onClick={photos.reload}>
                    重试
                </Button>
            ),
        },
    }

    return (
        <>
            <AppPage>
                <AppHeader align={isDownloadedView ? 'start' : 'end'}>
                    <AppTitle>{isDownloadedView ? '已下载图片' : '在线图库'}</AppTitle>
                    <AppAction>
                        {isDownloadedView ? (
                            <Button
                                size="icon"
                                variant="secondary"
                                tooltip="返回搜索"
                                aria-label="返回搜索"
                                onClick={() => setView('search')}
                            >
                                <ChevronLeft className="size-4" />
                            </Button>
                        ) : (
                            <Button
                                variant="outline"
                                aria-label="已下载"
                                disabled={isDownloadedView}
                                onClick={() => setView('downloaded')}
                            >
                                <CloudDownload className="size-4" />
                                已下载
                            </Button>
                        )}
                    </AppAction>
                    <AppAction>
                        {/* 密钥设置与刷新收进「更多」菜单，标题行只留视图切换 */}
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" tooltip="更多操作" aria-label="更多操作">
                                    <MoreHorizontal className="size-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onSelect={() => setIsKeyOpen(true)}>密钥设置</DropdownMenuItem>
                                <DropdownMenuItem onSelect={refresh}>刷新</DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </AppAction>
                    {/* 页头说明改为统计胶囊：悬停可看精确口径 */}
                    <AppDescription className="flex items-center gap-2">
                        <StockQuotaBadges total={total} remaining={status?.remaining ?? null} />
                    </AppDescription>
                    {/* 菜单行按视图换内容：搜索视图放搜索栏 + 话题标签，已下载视图放年月筛选 */}
                    <AppMenu>
                        {isDownloadedView ? (
                            <MonthSelect month={month} options={monthOptions} onChange={setMonth} />
                        ) : (
                            <>
                                <TopicTabRail
                                    items={TOPIC_TAB_ITEMS}
                                    value={toTopicTabValue(photos.topic)}
                                    onChange={handleTopicChange}
                                />
                                {/* 筛选行固定在页头，不随结果区滚动 */}
                                <StockFilterBar
                                    query={photos.query}
                                    onQueryChange={photos.setQuery}
                                    orientation={photos.orientation}
                                    onOrientationChange={photos.setOrientation}
                                    orderBy={photos.orderBy}
                                    onOrderByChange={photos.setOrderBy}
                                    isDisabled={photos.isLoadingFirst}
                                    isOrientationDisabled={photos.topic !== null}
                                    isSortDisabled={photos.query.trim().length > 0}
                                />
                            </>
                        )}
                    </AppMenu>
                </AppHeader>
                <AppContent isScrollable>
                    {isDownloadedView ? (
                        <ImageList
                            mode="grouped"
                            groups={localListGroups}
                            columns="compact"
                            aspect="4/3"
                            dimOnHover="strong"
                            isLoading={isLoading}
                            states={LOCAL_STATES}
                            paging={{
                                mode: 'sentinel',
                                hasMore: hasLocalMore,
                                isLoadingMore: false,
                                onLoadMore: loadLocalMore,
                            }}
                            actions={localActions}
                            onActivate={(item) => insert(item.source.id)}
                        />
                    ) : null}
                    {/* 搜索面板常驻挂载，切到已下载只做隐藏：回来时不丢搜索词，也不会重复消耗配额 */}
                    <div className={isDownloadedView ? 'hidden' : 'contents'}>
                        <ImageList
                            mode="flat"
                            items={searchItems}
                            columns="compact"
                            aspect="4/3"
                            dimOnHover="light"
                            isLoading={isConfigured && photos.isLoadingFirst}
                            errorText={isConfigured ? photos.errorText : null}
                            states={searchStates}
                            paging={{
                                mode: 'sentinel',
                                hasMore: photos.hasMore,
                                isLoadingMore: photos.isLoadingMore,
                                onLoadMore: photos.loadMore,
                            }}
                            actions={searchActions}
                            onActivate={(item) => insert(item.source.id)}
                        />
                    </div>
                </AppContent>
            </AppPage>

            <StockKeyDialog
                open={isKeyOpen}
                secretHint={status?.secretHint ?? null}
                onOpenChange={setIsKeyOpen}
                onSubmit={handleSaveKey}
            />

            <ConfirmDialog
                open={deletion.pending !== null}
                title="删除这张图片？"
                description="文件会移入系统回收站，正文里引用它的位置将显示破图。"
                confirmLabel="删除"
                isDestructive
                isSubmitting={deletion.isDeleting}
                size="sm"
                onOpenChange={(isOpen) => {
                    if (!isOpen) {
                        deletion.cancel()
                    }
                }}
                onConfirm={() => {
                    void deletion.confirm()
                }}
            />
        </>
    )
}
