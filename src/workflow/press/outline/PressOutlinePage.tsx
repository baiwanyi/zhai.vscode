/**
 * 大纲工作台：写作流程的第四步，按「功能模块 + 层级 + 颗粒度」组织，而不是一条事件链列表。
 * 复用约定：外壳取 components/AppPage（标题与动作走 AppHeader、作品名与统计走 AppSummary、
 * 模块与筛选走 OutlineFilters、三栏主体交给 AppContent）；卷章详情由 OutlineDetail 承担，
 * 七个功能模块由 OutlinePlanPanels / OutlineTrackPanels 承担，写前查纲与写后回填分别由
 * OutlineFocusView 与 OutlineBackfillDialog 承担；页头动作菜单由 OutlineActionMenu 承担。
 * 关键约束：模块与颗粒度只切视图、不写盘；每个面板的编辑只落盘自己那一段（onUpdatePlan 的 section 参数）；
 * 回填与模板会同时改多段，必须走 onApplyOutlineChange 立即写盘；
 * 宽容器用容器查询展开三栏，窄容器（VSCode 侧栏常态）在卷章模块退化为「树 → 详情」下钻，
 * 选中章节后隐藏树而不是压缩两栏；新增卷章只长大纲草稿，不建章节文件。
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
import { OutlineBackfillDialog } from './layout/OutlineBackfillDialog'
import { OutlineDetail } from './layout/OutlineDetail'
import { OutlineFilters } from './layout/OutlineFilters'
import { OutlineFocusView } from './layout/OutlineFocusView'
import {
    BookOutlinePanel,
    CharacterOutlinePanel,
    PacingPanel,
    SettingOutlinePanel,
    StructurePanel,
} from './layout/OutlinePlanPanels'
import { CluePanel, TimelinePanel } from './layout/OutlineTrackPanels'
import { OutlineTree } from './layout/OutlineTree'
import { OutlineWizard } from './layout/OutlineWizard'
import type { CreatedOutlineNode } from '../hooks/usePressMutations'
import type {
    OutlineChapter,
    OutlineExtractTarget,
    OutlineGranularity,
    OutlineModuleKey,
    OutlinePlan,
    OutlineSectionKey,
    OutlineTreeEntry,
    OutlineVolume,
    OutlineWorkspace,
    PlanStatus,
} from '../types'
import type { JSX } from 'react'
import { useOpenProjectDoc } from '../hooks/useOpenProjectDoc'
import {
    buildMinimalTemplate,
    chapterTitleLabel,
    createChapterRefEntries,
    createChapterRefOptions,
    createVolumeOptions,
    findClueWarnings,
    mergeTemplatePlan,
    summarizeWorkspace,
} from '../utils'

interface PressOutlinePageProps {
    workspace: OutlineWorkspace
    /** 当前作品目录：提取大纲读取该作品的 Materials 素材，回填读取章节事实 */
    dirPath: string
    defaultChapterWordGoal: number
    onUpdateChapter: (chapterId: string, patch: Partial<OutlineChapter>) => void
    /** 更新七个功能模块中的一段：只写该段对应的段落 */
    onUpdatePlan: (section: OutlineSectionKey, patch: Partial<OutlinePlan>) => void
    /** 大纲整批更新并立即写盘：回填与模板使用 */
    onApplyOutlineChange: (next: { volumes?: OutlineVolume[]; plan?: OutlinePlan }) => void
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
    onUpdatePlan,
    onApplyOutlineChange,
    onCreateVolume,
    onCreateChapter,
    onApplyOutline,
    onExtractOutline,
    onOpenChat,
}: PressOutlinePageProps): JSX.Element {
    const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null)
    const [module, setModule] = useState<OutlineModuleKey>('volume')
    const [granularity, setGranularity] = useState<OutlineGranularity>('medium')
    const [statusFilter, setStatusFilter] = useState<PlanStatus | 'all'>('all')
    /** 卷筛选：'all' 为全部卷，否则为卷 id，只影响左侧章节列表 */
    const [volumeFilter, setVolumeFilter] = useState('all')
    /** 标题搜索词：与卷筛选叠加，只收窄左侧列表 */
    const [query, setQuery] = useState('')
    const [isWizardOpen, setIsWizardOpen] = useState(false)
    const [isFocusOpen, setIsFocusOpen] = useState(false)
    const [isBackfillOpen, setIsBackfillOpen] = useState(false)
    const { isExtracting, extract } = useOutlineExtract(dirPath)
    const { openDoc } = useOpenProjectDoc(dirPath)

    const plan = workspace.plan
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
    /** 线索预警：按最后一个「已写」章位置判断逾期与临期 */
    const clueWarnings = useMemo(() => findClueWarnings(plan, workspace.volumes), [plan, workspace.volumes])
    /** 章节引用选项与条目：线索下拉与聚焦视图共用 */
    const refOptions = useMemo(() => createChapterRefOptions(workspace.volumes), [workspace.volumes])
    const refEntries = useMemo(() => createChapterRefEntries(workspace.volumes), [workspace.volumes])
    const selectedRef = refEntries.find((entry) => entry.chapter.id === selectedEntry?.chapter.id)?.ref ?? null
    /** 节奏面板按全书章序展示：跨卷后章序不重复，同步与排序才不会串卷 */
    const allChapters = useMemo<OutlineChapter[]>(() => {
        let globalOrder = 0
        return workspace.volumes.flatMap((volume) =>
            volume.chapters.map((chapter) => {
                globalOrder += 1
                return { ...chapter, order: globalOrder }
            }),
        )
    }, [workspace.volumes])
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
        setIsFocusOpen(false)
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
        setModule('volume')
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

    /** 套用最小模板：只填空字段，不覆盖已写内容；作品还没有卷时一并铺第一卷与首章 */
    const handleApplyTemplate = (): void => {
        const draft = buildMinimalTemplate(workspace.setting, workspace.characters, defaultChapterWordGoal)
        const nextPlan = mergeTemplatePlan(plan, draft.plan)
        const nextVolumes = workspace.volumes.length === 0 ? [draft.volume] : workspace.volumes
        onApplyOutlineChange({ volumes: nextVolumes, plan: nextPlan })
        setModule('book')
        toast.success('已套用最小模板：填空题可直接改写')
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

    /** 七个功能模块的内容区：每个面板只拿到自己那一段与对应的更新回调 */
    const renderModule = (): JSX.Element => {
        if (module === 'book') {
            return (
                <BookOutlinePanel
                    book={plan.book}
                    onChange={(patch) => onUpdatePlan('book', { book: { ...plan.book, ...patch } })}
                />
            )
        }
        if (module === 'structure') {
            return <StructurePanel acts={plan.acts} onChange={(acts) => onUpdatePlan('structure', { acts })} />
        }
        if (module === 'characters') {
            return (
                <CharacterOutlinePanel
                    lines={plan.characters}
                    characters={workspace.characters}
                    onChange={(lines) => onUpdatePlan('characters', { characters: lines })}
                />
            )
        }
        if (module === 'setting') {
            return (
                <SettingOutlinePanel
                    notes={plan.setting}
                    onChange={(notes) => onUpdatePlan('setting', { setting: notes })}
                />
            )
        }
        if (module === 'pacing') {
            return (
                <PacingPanel
                    entries={plan.pacing}
                    chapters={allChapters}
                    onChange={(pacing) => onUpdatePlan('pacing', { pacing })}
                />
            )
        }
        if (module === 'clue') {
            return (
                <CluePanel
                    clues={plan.clues}
                    characters={workspace.characters}
                    refOptions={refOptions}
                    warnings={clueWarnings}
                    onChange={(clues) => onUpdatePlan('clues', { clues })}
                />
            )
        }
        if (module === 'timeline') {
            return (
                <TimelinePanel
                    events={plan.timeline}
                    characters={workspace.characters}
                    onChange={(timeline) => onUpdatePlan('timeline', { timeline })}
                />
            )
        }
        if (selectedEntry === null) {
            return (
                <StateEmpty
                    icon={ListTree}
                    title="选择一章查看章纲"
                    description="左侧树中点选章节，或先生成一份大纲"
                    className="h-full"
                />
            )
        }
        if (isFocusOpen) {
            return (
                <OutlineFocusView
                    volume={selectedEntry.volume}
                    chapter={selectedEntry.chapter}
                    chapterRef={selectedRef ?? { volumeOrder: 1, chapterOrder: selectedEntry.chapter.order }}
                    characters={workspace.characters}
                    plan={plan}
                    prevChapter={
                        selectedEntry.volume.chapters.find(
                            (chapter) => chapter.order === selectedEntry.chapter.order - 1,
                        ) ?? null
                    }
                    nextChapter={
                        selectedEntry.volume.chapters.find(
                            (chapter) => chapter.order === selectedEntry.chapter.order + 1,
                        ) ?? null
                    }
                    onBack={() => setIsFocusOpen(false)}
                    onOpenBackfill={() => setIsBackfillOpen(true)}
                />
            )
        }
        return (
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
                onOpenFocus={() => setIsFocusOpen(true)}
                onOpenBackfill={() => setIsBackfillOpen(true)}
                viewGranularity={granularity}
            />
        )
    }

    const isVolumeModule = module === 'volume'
    /** 窄容器下钻：卷章模块一旦主动选中就隐藏左树，写前查纲也属于下钻状态 */
    const isDrilldown = isVolumeModule && hasActiveSelection

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
                            onApplyTemplate={handleApplyTemplate}
                        />
                    </AppAction>
                    <AppSummary
                        title={workspace.setting.title}
                        path={dirPath}
                        meta={`${workspace.volumes.length} 卷 · ${summary.chapters} 章 · 已写 ${summary.done} 章 · 待改 ${summary.revise} 章 · 废弃 ${summary.discarded} 章`}
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
                        module={module}
                        granularity={granularity}
                        statusFilter={statusFilter}
                        volumeFilter={volumeFilter}
                        volumeOptions={volumeOptions}
                        query={query}
                        onModuleChange={(next) => {
                            setModule(next)
                            setIsFocusOpen(false)
                        }}
                        onGranularityChange={setGranularity}
                        onStatusChange={setStatusFilter}
                        onVolumeChange={setVolumeFilter}
                        onQueryChange={setQuery}
                    />
                </AppHeader>

                <AppContent className="flex px-0">
                    {isVolumeModule ? (
                        <aside
                            className={cn(
                                'min-h-0 w-full overflow-y-auto px-2 py-2 @2xl:w-64 @2xl:shrink-0 @2xl:border-r @2xl:border-border',
                                isDrilldown && 'hidden @2xl:block',
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
                    ) : null}

                    <section
                        className={cn(
                            'min-h-0 w-full flex-1 overflow-hidden',
                            isVolumeModule && !isDrilldown && 'hidden @2xl:block',
                        )}
                    >
                        {renderModule()}
                    </section>

                    {isVolumeModule && selectedEntry !== null && !isFocusOpen && granularity !== 'coarse' ? (
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

            <OutlineBackfillDialog
                isOpen={isBackfillOpen}
                onOpenChange={setIsBackfillOpen}
                dirPath={dirPath}
                volumes={workspace.volumes}
                plan={plan}
                characters={workspace.characters}
                onApply={onApplyOutlineChange}
            />
        </>
    )
}
