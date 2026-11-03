/**
 * 在线图库页：Unsplash 搜索与「已下载」两个视图，点击即把图片插到当前 Markdown 光标处。
 * 独立常驻分区，入口在侧栏导航（品牌图标取自 resources/icons/unsplash.svg），与媒体并列。
 * 复用约定：外壳取 @webview/components/AppPage，「已下载」入口与返回按钮进标题行的 AppAction，
 * 密钥设置与刷新收进标题行的「更多」下拉菜单；月份筛选（MonthSelect）、话题标签与筛选行（StockFilterBar）都进 AppMenu（页头固定，不随结果滚动）；
 * 状态经 useStockStatus、搜索经 useStockPhotos（页头与面板共用同一份）、已下载经 useStockDownloaded、
 * 删除确认经 useStockDelete、插入经 useStockInsert，搜索侧内容交给 StockResultPanel；
 * 话题清单与「推荐位 ↔ null」折算在 ./layout/stockTopics，本页只管组装。
 * 关键约束：默认停在搜索——已下载是二级视图，进入后标题行左侧出现返回按钮回到搜索；
 * 搜索面板常驻挂载、切到已下载只做隐藏，返回时不丢搜索词也不重复消耗配额；
 * 话题标签是前端固定的常用清单、以「推荐」置首，点击即进入该话题浏览流，不回源拉取标签；
 * 标签行单行不换行，两端箭头滑动、到头即隐藏（TopicTabRail 私有组件）；
 * 输入搜索词即回到「推荐」——话题端点不接受关键词，留着旧话题高亮会误导；
 * 插入成功只做局部插卡，不整页重拉；删除走二次确认并如实说明正文引用会变破图；
 * 密钥明文只在弹窗输入期间存在，保存后立即丢弃。
 */
import { ChevronLeft, CloudDownload, MoreHorizontal } from 'lucide-react'
import { useMemo, useState } from 'react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@components/ui/dropdown-menu'
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
import { toMonthOptions } from './hooks/useImageFilters'
import { useStockDelete } from './hooks/useStockDelete'
import { useStockDownloaded } from './hooks/useStockDownloaded'
import { useStockInsert } from './hooks/useStockInsert'
import { useStockPhotos } from './hooks/useStockPhotos'
import { useStockStatus } from './hooks/useStockStatus'
import { MonthSelect } from './layout/MonthSelect'
import { ScrollRail } from './layout/ScrollRail'
import { StockFilterBar } from './layout/StockFilterBar'
import { StockKeyDialog } from './layout/StockKeyDialog'
import { StockLocalGallery } from './layout/StockLocalGallery'
import { StockQuotaBadges } from './layout/StockQuotaBadges'
import { StockResultPanel } from './layout/StockResultPanel'
import { TOPIC_TAB_ITEMS, toStockTopic, toTopicTabValue } from './layout/stockTopics'
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
 * 关键约束：本组件不认识具体话题、也不做滚动测量；选中值直接映射为分段栏的受控值，
 * 「推荐」与协议 null 的折算在上层（toTopicTabValue / toStockTopic）完成。
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

export function WorkflowStock(): JSX.Element {
    const { status, reload: reloadStatus, saveKey } = useStockStatus()
    const { items, months, total, isLoading, month, setMonth, reload, remove, prepend } = useStockDownloaded()
    const [view, setView] = useState<StockView>('search')
    const [isKeyOpen, setIsKeyOpen] = useState(false)

    const isDownloadedView = view === 'downloaded'
    const isConfigured = status?.configured === true
    /** 搜索状态放在页面层：页头的标签行与搜索面板共用同一份，切话题不必再往下透传 */
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
                        <StockLocalGallery
                            items={items}
                            isLoading={isLoading}
                            insertingId={insertingId}
                            failedId={failedId}
                            onInsert={insert}
                            onDelete={deletion.request}
                        />
                    ) : null}
                    {/* 搜索面板常驻挂载，切到已下载只做隐藏：回来时不丢搜索词，也不会重复消耗配额 */}
                    <div className={isDownloadedView ? 'hidden' : 'contents'}>
                        <StockResultPanel
                            isConfigured={isConfigured}
                            photos={photos}
                            onOpenKey={() => setIsKeyOpen(true)}
                            insertingId={insertingId}
                            failedId={failedId}
                            onInsert={insert}
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
