/**
 * 大纲工作台：写作流程的第四步，左侧卷-章树、中间章纲详情、右侧 AI 副驾。
 * 复用约定：外壳取 components/AppPage（标题与动作走 AppHeader、作品名与卷章统计走 AppSummary、
 * 完成度进度走 AppMenu、三栏主体交给非滚动的 AppContent），三个区域分别由 OutlineTree、
 * OutlineDetail、OutlineAiPanel 承担，本文件负责选中项、筛选状态的派生、向导与提取的编排；
 * 页头筛选控件由 OutlineFilters 承担（状态 / 卷 / 标题搜索），动作菜单由 OutlineActionMenu 承担，
 * 统计口径来自 utils 的 summarizeWorkspace，卷选项复用 createVolumeOptions，标题匹配复用 chapterTitleLabel。
 * 关键约束：宽容器用容器查询展开三栏，窄容器（VSCode 侧栏常态）退化为「树 → 详情」下钻，
 * 选中章节后必须隐藏树而不是压缩两栏；左侧章节平铺且不分组，卷筛选只收窄列表，
 * 右侧详情与选中项始终按全量 entries 解析，避免筛选把当前章节「筛丢」；
 * 动作菜单里的「新增卷 / 新增章节」只长大纲草稿，不建章节文件——大纲是计划，
 * 作品列表才是内容输出，两者不要求章数一致；作品列表新增的卷章由宿主补写进大纲.md，本页不反向对齐。
 * 新增后直接选中新节点并复位筛选，避免刚建的章被状态 / 卷筛选挡住；
 * 头部「打开文档」按文档键打开大纲.md，不参与草稿状态；
 * 提取范围在动作菜单的「素材提取」里选择：候选来自仪表盘的作品列表（素材由章节清单产出），
 * 全篇整树覆盖，章节范围与指定章节按「卷序 + 卷内位置」只刷新对应章的章纲字段。
 * 三栏各自滚动，AppContent 不可用 isScrollable，只能给出 flex 容器并去掉默认左右内边距。
 */
import { cn } from 'cn'
import { FileText, ListTree } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Progress } from '@components/ui/progress'
import type { PressExtractedVolume } from '@shared/types/press'
import { AppAction, AppContent, AppHeader, AppPage, AppTitle } from '@webview/components/AppPage'
import { AppSummary } from '@webview/components/AppSummary'
import { Button } from '@webview/components/Button'
import { StateEmpty } from '@webview/components/StateEmpty'
import { useOutlineExtract } from './hooks/useOutlineExtract'
import { OutlineActionMenu } from './layout/OutlineActionMenu'
import { OutlineAiPanel } from './layout/OutlineAiPanel'
import { OutlineDetail } from './layout/OutlineDetail'
import { OutlineFilters } from './layout/OutlineFilters'
import { OutlineTree } from './layout/OutlineTree'
import { OutlineWizard } from './layout/OutlineWizard'
import type { CreatedOutlineNode } from '../hooks/usePressMutations'
import type {
    OutlineChapter,
    OutlineExtractTarget,
    OutlineTreeEntry,
    OutlineVolume,
    OutlineWorkspace,
    PlanStatus,
} from '../types'
import type { JSX } from 'react'
import { useOpenProjectDoc } from '../hooks/useOpenProjectDoc'
import { chapterTitleLabel, createVolumeOptions, summarizeWorkspace } from '../utils'

interface PressOutlinePageProps {
    workspace: OutlineWorkspace
    /** 当前作品目录：提取大纲读取该作品的 Materials 素材 */
    dirPath: string
    defaultChapterWordGoal: number
    onUpdateChapter: (chapterId: string, patch: Partial<OutlineChapter>) => void
    /** 新增卷：只增大纲草稿，返回落点供页面选中 */
    onCreateVolume: () => CreatedOutlineNode | null
    /** 新增章节：落到指定卷（缺省最后一卷），返回落点供页面选中 */
    onCreateChapter: (volumeId?: string) => CreatedOutlineNode | null
    onApplyOutline: (volumes: OutlineVolume[]) => void
    /** 用素材重建大纲：mode 为 all 时覆盖整棵树，orders 时只刷新所选章，返回实际处理的章数 */
    onExtractOutline: (drafts: PressExtractedVolume[], target: OutlineExtractTarget) => number
    onOpenChat: () => void
}

export function PressOutlinePage({
    workspace,
    dirPath,
    defaultChapterWordGoal,
    onUpdateChapter,
    onCreateVolume,
    onCreateChapter,
    onApplyOutline,
    onExtractOutline,
    onOpenChat,
}: PressOutlinePageProps): JSX.Element {
    const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null)
    const [statusFilter, setStatusFilter] = useState<PlanStatus | 'all'>('all')
    /** 卷筛选：'all' 为全部卷，否则为卷 id，只影响左侧章节列表 */
    const [volumeFilter, setVolumeFilter] = useState('all')
    /** 标题搜索词：与卷筛选叠加，只收窄左侧列表 */
    const [query, setQuery] = useState('')
    const [isWizardOpen, setIsWizardOpen] = useState(false)
    const { isExtracting, extract } = useOutlineExtract(dirPath)
    const { openDoc } = useOpenProjectDoc(dirPath)

    const entries = useMemo<OutlineTreeEntry[]>(
        () => workspace.volumes.flatMap((volume) => volume.chapters.map((chapter) => ({ volume, chapter }))),
        [workspace.volumes],
    )
    const selectedEntry = entries.find((entry) => entry.chapter.id === selectedChapterId) ?? entries.at(0) ?? null
    const summary = summarizeWorkspace(workspace.volumes)
    const donePercent = summary.chapters > 0 ? Math.round((summary.done / summary.chapters) * 100) : 0
    // 下钻状态只看用户是否主动点选过：窄容器下初始停在树，宽容器由 @2xl 断点强制并排
    const hasActiveSelection = selectedChapterId !== null
    /** 卷筛选选项：取值用卷 id，卷名允许重名 */
    const volumeOptions = useMemo(() => createVolumeOptions(entries), [entries])
    /** 树里展示的章节：卷筛选与标题搜索只收窄左侧列表，右侧详情与选中项仍按全量 entries 解析 */
    const treeEntries = useMemo(() => {
        const keyword = query.trim().toLowerCase()
        return entries.filter((entry) => {
            if (volumeFilter !== 'all' && entry.volume.id !== volumeFilter) {
                return false
            }
            if (keyword.length === 0) {
                return true
            }
            return chapterTitleLabel(entry.chapter).toLowerCase().includes(keyword)
        })
    }, [entries, query, volumeFilter])

    const handleSelectChapter = (chapterId: string): void => {
        setSelectedChapterId(chapterId)
    }

    /**
     * 新增落点：先清掉筛选再选中新节点——刚建的一律是「待写」，状态筛选会把它挡在列表外；
     * 卷筛选同理，新卷不在旧选项里。清筛选后新章必然在树中可见。
     */
    const applyCreatedNode = (created: CreatedOutlineNode | null): void => {
        if (created === null) {
            return
        }
        setStatusFilter('all')
        setVolumeFilter('all')
        setQuery('')
        if (created.chapterId !== null) {
            setSelectedChapterId(created.chapterId)
        }
    }

    /** 新增卷：卷与首条空章纲由数据层生成，选中其首章 */
    const handleCreateVolume = (): void => {
        applyCreatedNode(onCreateVolume())
    }

    /**
     * 新增章节的落点：优先跟随卷筛选，其次跟随用户主动选中的章所在卷；
     * 两者都没有时留空，由数据层落到最后一卷——未点选时的默认展示章不代表用户的编辑意图。
     */
    const handleCreateChapter = (): void => {
        if (volumeFilter !== 'all') {
            applyCreatedNode(onCreateChapter(volumeFilter))
            return
        }
        applyCreatedNode(onCreateChapter(selectedChapterId === null ? undefined : selectedEntry?.volume.id))
    }

    /** 提取：target 决定整树覆盖还是刷新指定章；素材都是全量解析，范围只影响写入 */
    const handleExtract = (target: OutlineExtractTarget): void => {
        const run = async (): Promise<void> => {
            const result = await extract()
            if (result === null) {
                return
            }
            if (result.volumes.length === 0) {
                toast.info(result.message)
                return
            }
            if (target.mode === 'all') {
                const chapterCount = onExtractOutline(result.volumes, target)
                // 重建后的卷章 id 全部换新，旧选中项已失效，回到默认的首章
                setSelectedChapterId(null)
                toast.success(`${result.message}，已替换当前大纲（${String(chapterCount)} 章）`)
                return
            }
            const refreshed = onExtractOutline(result.volumes, target)
            // 范围提取不改动章 id，选中项可以保留
            if (refreshed === 0) {
                toast.info('所选卷章在大纲里没有对应位置：确认大纲卷名带「第N卷」，或先用全篇重建')
                return
            }
            toast.success(`${result.message}，已刷新 ${String(refreshed)} 章章纲`)
        }
        void run()
    }

    return (
        <>
            <AppPage>
                <AppHeader>
                    <AppTitle>大纲</AppTitle>
                    <AppAction>
                        <Button
                            variant="outline"
                            tooltip="打开大纲文档，卷纲与章纲的原文可直接编辑"
                            onClick={() => openDoc('outline')}
                        >
                            <FileText />
                            打开文档
                        </Button>
                        <OutlineActionMenu
                            dirPath={dirPath}
                            isExtracting={isExtracting}
                            onExtract={handleExtract}
                            onCreateVolume={handleCreateVolume}
                            onCreateChapter={handleCreateChapter}
                            onOpenWizard={() => setIsWizardOpen(true)}
                        />
                    </AppAction>
                    <AppSummary
                        title={workspace.setting.title}
                        path={dirPath}
                        meta={`${workspace.volumes.length} 卷 · ${summary.chapters} 章 · 已完成 ${summary.done} 章`}
                    >
                        <div className="flex w-full items-center gap-2">
                            <Progress
                                value={donePercent}
                                className="h-1 min-w-0 flex-1"
                                aria-label={`章节完成度 ${donePercent}%`}
                            />
                            <span className="shrink-0 text-muted-foreground tabular-nums">{donePercent}%</span>
                        </div>
                    </AppSummary>
                    <OutlineFilters
                        statusFilter={statusFilter}
                        volumeFilter={volumeFilter}
                        volumeOptions={volumeOptions}
                        query={query}
                        onStatusChange={setStatusFilter}
                        onVolumeChange={setVolumeFilter}
                        onQueryChange={setQuery}
                    />
                </AppHeader>

                <AppContent className="flex px-0">
                    <aside
                        className={cn(
                            'min-h-0 w-full overflow-y-auto px-2 py-2 @2xl:w-64 @2xl:shrink-0 @2xl:border-r @2xl:border-border',
                            hasActiveSelection && 'hidden @2xl:block',
                        )}
                    >
                        <OutlineTree
                            entries={treeEntries}
                            selectedChapterId={selectedChapterId}
                            statusFilter={statusFilter}
                            hasAnyChapter={entries.length > 0}
                            isListFiltered={volumeFilter !== 'all' || query.trim().length > 0}
                            onSelectChapter={handleSelectChapter}
                        />
                    </aside>

                    <section
                        className={cn(
                            'min-h-0 w-full flex-1 overflow-hidden @2xl:block',
                            !hasActiveSelection && 'hidden @2xl:block',
                        )}
                    >
                        {selectedEntry ? (
                            <OutlineDetail
                                volume={selectedEntry.volume}
                                chapter={selectedEntry.chapter}
                                characters={workspace.characters}
                                prevChapter={
                                    selectedEntry.volume.chapters.find(
                                        (chapter) => chapter.order === selectedEntry.chapter.order - 1,
                                    ) ?? null
                                }
                                nextChapters={selectedEntry.volume.chapters
                                    .filter((chapter) => chapter.order > selectedEntry.chapter.order)
                                    .slice(0, 2)}
                                onChange={(patch) => onUpdateChapter(selectedEntry.chapter.id, patch)}
                                onBack={() => setSelectedChapterId(null)}
                                onOpenChat={onOpenChat}
                                onOpenWizard={() => setIsWizardOpen(true)}
                            />
                        ) : (
                            <StateEmpty
                                icon={ListTree}
                                title="选择一章查看章纲"
                                description="左侧树中点选章节，或先生成一份大纲"
                                className="h-full"
                            />
                        )}
                    </section>

                    {selectedEntry ? (
                        <aside className="hidden min-h-0 w-72 shrink-0 @4xl:flex">
                            <OutlineAiPanel
                                setting={workspace.setting}
                                volume={selectedEntry.volume}
                                chapter={selectedEntry.chapter}
                                characters={workspace.characters}
                                onOpenChat={onOpenChat}
                                onOpenWizard={() => setIsWizardOpen(true)}
                            />
                        </aside>
                    ) : null}
                </AppContent>
            </AppPage>

            {/* key 绑定打开状态：每次重新打开都重建向导，草案与步骤不会从上一次带过来 */}
            <OutlineWizard
                key={isWizardOpen ? 'wizard-open' : 'wizard-closed'}
                isOpen={isWizardOpen}
                onOpenChange={setIsWizardOpen}
                setting={workspace.setting}
                characters={workspace.characters}
                existingChapterCount={summary.chapters}
                defaultChapterWordGoal={defaultChapterWordGoal}
                onApply={onApplyOutline}
            />
        </>
    )
}
