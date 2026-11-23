/**
 * 大纲工作台：写作流程的第四步，按「功能模块 + 层级 + 颗粒度」组织，而不是一条事件链列表。
 * 复用约定：外壳取 components/AppPage（标题与动作走 AppHeader、作品名与统计走 AppSummary、
 * 模块与筛选走 OutlineFilters、三栏主体交给 AppContent）；章纲详情由 OutlineDetail 承担，
 * 卷纲详情由 OutlineVolumeDetail 承担，按卷生成章纲的预览与写入由 OutlineVolumeChaptersDialog 承担；
 * 结构与线索两个功能模块由 OutlinePlanPanels / OutlineTrackPanels 承担，
 * 写前查纲与写后回填分别由 OutlineFocusView 与 OutlineBackfillDialog 承担；
 * 页头动作菜单由 OutlineActionMenu 承担；故事核（梗概、冲突、主题、弧光）不在本页维护，统一由作品设定承载。
 * 关键约束：模块与颗粒度只切视图、不写盘；每个面板的编辑只落盘自己那一段（onUpdatePlan 的 section 参数）；
 * 回填与模板会同时改多段，必须走 onApplyOutlineChange 立即写盘；
 * 页头的「卷」下拉兼作导航：选中某卷即进入卷纲视图并清空章节选中，选「全部卷」回到章节列表；
 * 宽容器用容器查询展开三栏，窄容器（VSCode 侧栏常态）在卷章模块退化为「树 → 详情」下钻，
 * 选中章节或进入卷纲视图后隐藏树而不是压缩两栏；新增卷章只长大纲草稿，不建章节文件。
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
import { StructurePanel } from './layout/OutlinePlanPanels'
import { CluePanel } from './layout/OutlineTrackPanels'
import { OutlineTree } from './layout/OutlineTree'
import { OutlineVolumeCards } from './layout/OutlineVolumeCards'
import { OutlineVolumeChaptersDialog } from './layout/OutlineVolumeChaptersDialog'
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
} from '../types'
import type { ChapterSeed, VolumeChapterWriteMode } from '../utils'
import type { JSX } from 'react'
import { useOpenProjectDoc } from '../hooks/useOpenProjectDoc'
import {
    buildMinimalTemplate,
    chapterTitleLabel,
    createAct,
    createChapterRefEntries,
    createChapterRefOptions,
    createClue,
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
    /** 更新卷纲字段：卷名、核心事件、情节脉络与转折在卷纲视图里编辑 */
    onUpdateVolume: (volumeId: string, patch: Partial<OutlineVolume>) => void
    /** 按卷写入章纲草案：追加到卷末或替换空章，返回实际写入章数 */
    onApplyVolumeChapters: (volumeId: string, seeds: readonly ChapterSeed[], mode: VolumeChapterWriteMode) => number
    /** 更新功能模块中的一段：只写该段对应的段落 */
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
    onUpdateVolume,
    onApplyVolumeChapters,
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
    /** 颗粒度视图已取消筛选入口，固定为中纲：仅作为渲染粒度传给章纲详情与 AI 面板条件 */
    const granularity: OutlineGranularity = 'medium'
    /** 当前卷：'all' 为全部卷，否则为卷 id；兼作卷纲视图的开关，同时收窄左侧章节列表 */
    const [volumeFilter, setVolumeFilter] = useState('all')
    /** 标题搜索词：与卷筛选叠加，只收窄左侧列表 */
    const [query, setQuery] = useState('')
    const [isWizardOpen, setIsWizardOpen] = useState(false)
    const [isFocusOpen, setIsFocusOpen] = useState(false)
    const [isBackfillOpen, setIsBackfillOpen] = useState(false)
    const [isGenerateOpen, setIsGenerateOpen] = useState(false)
    /** 正在生成章纲的卷：由卷纲卡片的「生成章纲」指定，与页头卷筛选相互独立 */
    const [generatingVolumeId, setGeneratingVolumeId] = useState<string | null>(null)
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
    const volumeOptions = useMemo(() => createVolumeOptions(workspace.volumes), [workspace.volumes])
    /** 线索预警：按最后一个「已写」章位置判断逾期与临期 */
    const clueWarnings = useMemo(() => findClueWarnings(plan, workspace.volumes), [plan, workspace.volumes])
    /** 章节引用选项与条目：线索下拉与聚焦视图共用 */
    const refOptions = useMemo(() => createChapterRefOptions(workspace.volumes), [workspace.volumes])
    const refEntries = useMemo(() => createChapterRefEntries(workspace.volumes), [workspace.volumes])
    const selectedRef = refEntries.find((entry) => entry.chapter.id === selectedEntry?.chapter.id)?.ref ?? null
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

    /** 正在生成章纲的卷：对话框打开时定位目标卷 */
    const generatingVolume =
        generatingVolumeId === null
            ? null
            : (workspace.volumes.find((volume) => volume.id === generatingVolumeId) ?? null)

    const handleSelectChapter = (chapterId: string): void => {
        setSelectedChapterId(chapterId)
        setIsFocusOpen(false)
    }

    /**
     * 页头切卷：卷筛选只作用于章纲页，因此切卷同时进入章纲页并清掉章节选中与聚焦视图，
     * 避免停留在上一卷的章上；选「全部卷」只清筛选，仍停在章纲页。
     */
    const handleVolumeChange = (next: string): void => {
        setVolumeFilter(next)
        setSelectedChapterId(null)
        setIsFocusOpen(false)
        setModule('chapter')
    }

    /** 卷纲卡片点击：进入章纲页并按该卷筛选，同时选中该卷首章便于直接编辑 */
    const handleOpenVolumeChapters = (volume: OutlineVolume): void => {
        setModule('chapter')
        setVolumeFilter(volume.id)
        setSelectedChapterId(volume.chapters[0]?.id ?? null)
        setIsFocusOpen(false)
    }

    /** 卷纲卡片上的「生成章纲」：只负责打开对话框，目标卷与页头筛选互不影响 */
    const handleGenerateVolumeChapters = (volume: OutlineVolume): void => {
        setGeneratingVolumeId(volume.id)
        setIsGenerateOpen(true)
    }

    /**
     * 新增落点：先清掉筛选再选中新节点——卷筛选下新卷不在旧选项里，搜索词也会把新章挡在列表外。
     * 清筛选后新章必然在树中可见。
     */
    const applyCreatedNode = (created: CreatedOutlineNode | null): void => {
        if (created === null) {
            return
        }
        setVolumeFilter('all')
        setQuery('')
        setModule('chapter')
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

    /** 页头第二行的新增入口：按当前模块分派到对应数据操作，模块页面内不再各放一个按钮 */
    const handleAddByModule = (): void => {
        if (module === 'volume') {
            handleCreateVolume()
            return
        }
        if (module === 'chapter') {
            handleCreateChapter()
            return
        }
        if (module === 'structure') {
            onUpdatePlan('structure', { acts: [...plan.acts, createAct()] })
            return
        }
        onUpdatePlan('clues', { clues: [...plan.clues, createClue()] })
    }

    /** 套用最小模板：只填空字段，不覆盖已写内容；作品还没有卷时一并铺第一卷与首章 */
    const handleApplyTemplate = (): void => {
        const draft = buildMinimalTemplate(workspace.setting, workspace.characters, defaultChapterWordGoal)
        const nextPlan = mergeTemplatePlan(plan, draft.plan)
        const nextVolumes = workspace.volumes.length === 0 ? [draft.volume] : workspace.volumes
        onApplyOutlineChange({ volumes: nextVolumes, plan: nextPlan })
        setModule('structure')
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

    /** 功能模块的内容区：每个面板只拿到自己那一段与对应的更新回调 */
    const renderModule = (): JSX.Element => {
        if (module === 'structure') {
            return <StructurePanel acts={plan.acts} onChange={(acts) => onUpdatePlan('structure', { acts })} />
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

    const isChapterModule = module === 'chapter'
    /** 窄容器下钻：章纲页主动选中章节即隐藏左树，写前查纲同样属于下钻状态 */
    const isDrilldown = isChapterModule && hasActiveSelection

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
                        volumeFilter={volumeFilter}
                        volumeOptions={volumeOptions}
                        query={query}
                        onModuleChange={(next) => {
                            setModule(next)
                            setIsFocusOpen(false)
                        }}
                        onVolumeChange={handleVolumeChange}
                        onQueryChange={setQuery}
                        onAdd={handleAddByModule}
                    />
                </AppHeader>

                <AppContent className="flex px-0">
                    {module === 'volume' ? (
                        <OutlineVolumeCards
                            volumes={workspace.volumes}
                            onUpdate={onUpdateVolume}
                            onOpenChapters={handleOpenVolumeChapters}
                            onGenerateChapters={handleGenerateVolumeChapters}
                        />
                    ) : (
                        <>
                            {isChapterModule ? (
                                <aside
                                    className={cn(
                                        'min-h-0 w-full overflow-y-auto px-2 py-2 @2xl:w-64 @2xl:shrink-0 @2xl:border-r @2xl:border-border',
                                        isDrilldown && 'hidden @2xl:block',
                                    )}
                                >
                                    <OutlineTree
                                        entries={treeEntries}
                                        selectedChapterId={selectedChapterId}
                                        hasAnyChapter={entries.length > 0}
                                        isListFiltered={volumeFilter !== 'all' || query.trim().length > 0}
                                        onSelectChapter={handleSelectChapter}
                                    />
                                </aside>
                            ) : null}

                            <section
                                className={cn(
                                    'min-h-0 w-full flex-1 overflow-hidden',
                                    isChapterModule && !isDrilldown && 'hidden @2xl:block',
                                )}
                            >
                                {renderModule()}
                            </section>

                            {isChapterModule && selectedEntry !== null && !isFocusOpen ? (
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
                        </>
                    )}
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

            {/* key 绑定打开状态：每次重新打开都重建对话框，草案、勾选与章数不会从上一次带过来 */}
            <OutlineVolumeChaptersDialog
                key={isGenerateOpen ? 'generate-open' : 'generate-closed'}
                isOpen={isGenerateOpen && generatingVolume !== null}
                onOpenChange={setIsGenerateOpen}
                volume={generatingVolume}
                setting={workspace.setting}
                characters={workspace.characters}
                onApply={(drafts, mode) => {
                    if (generatingVolume === null) {
                        return 0
                    }
                    return onApplyVolumeChapters(
                        generatingVolume.id,
                        drafts.map((draft) => ({
                            stage: draft.stage,
                            title: draft.title,
                            summary: draft.summary,
                            beats: draft.beats,
                        })),
                        mode,
                    )
                }}
            />
        </>
    )
}
