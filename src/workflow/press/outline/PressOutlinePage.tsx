/**
 * 大纲工作台：卷纲 / 章纲 / 结构 / 伏笔四模块的装配与导航。
 * 复用约定：外壳取 @webview/components/AppPage，详情、树、筛选与对话框分别取 ./layout 下对应组件。
 * 关键约束：模块切换只切视图；各面板只写自己段落；生成卷章时把结构与本卷伏笔作为约束传入，
 * 草案里的伏笔关联在写入时按实际章序回写伏笔表；清空章纲只删条目、不碰 Chapters 文件。
 */
import { cn } from 'cn'
import { FilePlus, FileText, Layers, Lightbulb, ListPlus, ListTree } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Progress } from '@components/ui/progress'
import type { AiContextAddInlineResult } from '@shared/types/aiChat'
import type { PressExtractedVolume, VolumeOutlineDraft } from '@shared/types/press'
import { request } from '@shared/utils/bridge'
import { toastError } from '@shared/utils/error'
import { StateEmpty } from '@webview/blocks/StateEmpty'
import { AlertDialog } from '@webview/components/AlertDialog'
import { AppAction, AppContent, AppHeader, AppPage, AppTitle } from '@webview/components/AppPage'
import { AppSummary } from '@webview/components/AppSummary'
import { Button } from '@webview/components/Button'
import { useOutlineExtract } from './hooks/useOutlineExtract'
import { ChapterAiPanel } from './layout/ChapterAiPanel'
import { ChapterBackfillDialog } from './layout/ChapterBackfillDialog'
import { ChapterDetail } from './layout/ChapterDetail'
import { ChapterFocusView } from './layout/ChapterFocusView'
import { ChapterTree } from './layout/ChapterTree'
import { ClueTrackPanels } from './layout/ClueTrackPanels'
import { OutlineActionMenu } from './layout/OutlineActionMenu'
import { OutlineFilters } from './layout/OutlineFilters'
import { StructurePanel } from './layout/StructureActPanels'
import { VolumeCards } from './layout/VolumeCards'
import { VolumeGenerateChaptersDialog } from './layout/VolumeGenerateChaptersDialog'
import { VolumeGenerateOutlinesDialog } from './layout/VolumeGenerateOutlinesDialog'
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
import type { JSX, ReactNode } from 'react'
import { useOpenProjectDoc } from '../hooks/useOpenProjectDoc'
import {
    chapterTitleLabel,
    createAct,
    createChapterRefEntries,
    createChapterRefOptions,
    createClue,
    createVolumeOptions,
    findClueWarnings,
    formatVolumeOutlineText,
    readOutlineVolumeOrder,
    summarizeWorkspace,
    toOutlineActContexts,
    toVolumeClueContexts,
    volumeTitleLabel,
} from '../utils'

interface PressOutlinePageProps {
    workspace: OutlineWorkspace
    /** 当前作品目录：提取大纲读取该作品的 Materials 素材，回填读取章节事实 */
    dirPath: string
    onUpdateChapter: (chapterId: string, patch: Partial<OutlineChapter>) => void
    /** 更新卷纲字段：卷名、核心事件、情节脉络与转折在卷纲视图里编辑 */
    onUpdateVolume: (volumeId: string, patch: Partial<OutlineVolume>) => void
    /** 按卷写入章纲草案：追加到卷末或替换空章，返回实际写入章数 */
    onApplyVolumeChapters: (volumeId: string, seeds: readonly ChapterSeed[], mode: VolumeChapterWriteMode) => number
    /** 更新功能模块中的一段：只写该段对应的段落 */
    onUpdatePlan: (section: OutlineSectionKey, patch: Partial<OutlinePlan>) => void
    /** 大纲整批更新并立即写盘：写后回填一次改卷章与伏笔时使用 */
    onApplyOutlineChange: (next: { volumes?: OutlineVolume[]; plan?: OutlinePlan }) => void
    /** 新增卷：只增大纲草稿，返回落点；页面只用它判断是否成功，落点是卷纲卡片而非章纲 */
    onCreateVolume: () => CreatedOutlineNode | null
    /** 新增章节：落到指定卷（缺省最后一卷），返回落点供页面选中 */
    onCreateChapter: (volumeId?: string) => CreatedOutlineNode | null
    /** 写入 AI 生成的卷纲：按卷序覆盖卷纲字段，章节保留，返回写入卷数 */
    onApplyVolumeOutlines: (drafts: readonly VolumeOutlineDraft[]) => number
    /** 用素材重建大纲：mode 为 all 时覆盖整棵树，orders 时只刷新所选章，返回实际处理的章数 */
    onExtractOutline: (drafts: PressExtractedVolume[], target: OutlineExtractTarget) => number
    onOpenChat: () => void
}

export function PressOutlinePage({
    workspace,
    dirPath,
    onUpdateChapter,
    onUpdateVolume,
    onApplyVolumeChapters,
    onUpdatePlan,
    onApplyOutlineChange,
    onCreateVolume,
    onCreateChapter,
    onApplyVolumeOutlines,
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
    const [isFocusOpen, setIsFocusOpen] = useState(false)
    const [isBackfillOpen, setIsBackfillOpen] = useState(false)
    const [isGenerateOpen, setIsGenerateOpen] = useState(false)
    /** 生成卷纲的预览对话框与覆盖确认框：两者互斥，确认后才打开预览 */
    const [isOutlinesOpen, setIsOutlinesOpen] = useState(false)
    const [isOutlinesConfirmOpen, setIsOutlinesConfirmOpen] = useState(false)
    /** 正在生成章纲的卷：由卷纲卡片的「生成章纲」指定，与页头卷筛选相互独立 */
    const [generatingVolumeId, setGeneratingVolumeId] = useState<string | null>(null)
    /** 待删除的卷：非空时弹出确认框，确认后才整体落盘 */
    const [deletingVolumeId, setDeletingVolumeId] = useState<string | null>(null)
    /** 待清空章纲的卷：非空时弹出确认框，确认后移除该卷全部章节并落盘 */
    const [clearingVolumeId, setClearingVolumeId] = useState<string | null>(null)
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
    /** 伏笔预警：按最后一个「已写」章位置判断逾期与临期 */
    const clueWarnings = useMemo(() => findClueWarnings(plan, workspace.volumes), [plan, workspace.volumes])
    /** 章节引用选项与条目：伏笔下拉与聚焦视图共用 */
    const refOptions = useMemo(() => createChapterRefOptions(workspace.volumes), [workspace.volumes])
    const refEntries = useMemo(() => createChapterRefEntries(workspace.volumes), [workspace.volumes])
    /** 卷位选项：结构阶段按卷序定位，与伏笔的引用口径一致 */
    const actVolumeOptions = useMemo(
        () =>
            workspace.volumes.map((volume, index) => ({
                value: String(readOutlineVolumeOrder(volume.name, index)),
                label: volumeTitleLabel(volume.name, index),
            })),
        [workspace.volumes],
    )
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
    /** 生成上下文：全书结构约束分卷与分章，本卷伏笔只取埋设或回收落在本卷的条目 */
    const actContexts = useMemo(() => toOutlineActContexts(plan.acts), [plan.acts])
    const generatingVolumeClues = useMemo(
        () =>
            generatingVolume === null
                ? []
                : toVolumeClueContexts(plan.clues, workspace.volumes, generatingVolume.id),
        [generatingVolume, plan.clues, workspace.volumes],
    )

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

    /**
     * 新增卷：落点是卷纲页的新卡片，不跟随首章跳到章纲；切到卷纲模块并清掉搜索词
     * （搜索只作用于章纲树），新卡在当前滚动区末尾即可见，选中项保持不动以便回到章纲时续在原章。
     */
    const handleCreateVolume = (): void => {
        if (onCreateVolume() === null) {
            return
        }
        setModule('volume')
        setQuery('')
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

    /** 页头新增按钮的「添加阶段」：只在结构段末尾追加一条空阶段 */
    const handleCreateAct = (): void => {
        onUpdatePlan('structure', { acts: [...plan.acts, createAct()] })
    }

    /** 页头新增按钮的「添加伏笔」：只在伏笔段末尾追加一条空伏笔 */
    const handleCreateClue = (): void => {
        onUpdatePlan('clues', { clues: [...plan.clues, createClue()] })
    }

    /**
     * 页头唯一的新增入口：动作、文案与图标都跟随当前模块标签——卷纲加卷、章纲加章、
     * 结构加阶段、伏笔页加伏笔。四项原先散在动作菜单里，合并成一个按钮后不必先开菜单再选类型。
     */
    const addActions: Record<OutlineModuleKey, { label: string; icon: ReactNode; onClick: () => void }> = {
        volume: { label: '新增卷', icon: <Layers />, onClick: handleCreateVolume },
        chapter: { label: '添加章节', icon: <FilePlus />, onClick: handleCreateChapter },
        structure: { label: '添加阶段', icon: <ListPlus />, onClick: handleCreateAct },
        clue: { label: '添加伏笔', icon: <Lightbulb />, onClick: handleCreateClue },
    }
    const addAction = addActions[module]

    /** 卷纲是否已有内容：任一卷填了核心事件 / 主要情节 / 转折 / 卷末结果，就视为需要确认覆盖 */
    const hasVolumeOutline = workspace.volumes.some(
        (volume) =>
            volume.coreEvent.trim().length > 0 ||
            volume.mainPlot.length > 0 ||
            volume.turningPoints.length > 0 ||
            volume.result.trim().length > 0,
    )

    /** 生成卷纲入口：已有卷纲先确认覆盖，避免一键抹掉手写内容；章节不受影响 */
    const handleGenerateVolumeOutlines = (): void => {
        if (hasVolumeOutline) {
            setIsOutlinesConfirmOpen(true)
            return
        }
        setIsOutlinesOpen(true)
    }

    /** 卷纲卡片的删除：只打开确认框，确认后才整体落盘 */
    const handleDeleteVolume = (volume: OutlineVolume): void => {
        setDeletingVolumeId(volume.id)
    }

    /** 卷纲卡片的清空章纲：只打开确认框，确认后移除该卷全部章节条目 */
    const handleClearVolumeChapters = (volume: OutlineVolume): void => {
        setClearingVolumeId(volume.id)
    }

    /** 上移 / 下移：只调整卷顺序——卷号由位置推导，顺序变了卷号随之变化 */
    const handleMoveVolume = (volumeId: string, direction: -1 | 1): void => {
        const index = workspace.volumes.findIndex((volume) => volume.id === volumeId)
        const target = index + direction
        if (index < 0 || target < 0 || target >= workspace.volumes.length) {
            return
        }
        const next = [...workspace.volumes]
        const [moved] = next.splice(index, 1)
        if (moved === undefined) {
            return
        }
        next.splice(target, 0, moved)
        onApplyOutlineChange({ volumes: next })
    }

    /**
     * 添加到 AI 对话：把卷纲快照作为内联上下文交给宿主，宿主生成 Badge 引用并切到对话分区。
     * 关键约束：上下文芯片由宿主维护，前端不本地拼装；uri 用作品目录 + 卷 id 作稳定去重键。
     */
    const handleAddVolumeToChat = (volume: OutlineVolume, index: number): void => {
        const run = async (): Promise<void> => {
            try {
                await request<AiContextAddInlineResult>('ai/context/addInline', {
                    label: `${workspace.setting.title.trim() || '未命名作品'}·卷纲·${volumeTitleLabel(volume.name, index)}`,
                    text: formatVolumeOutlineText(volume, index),
                    uri: `press-outline:${dirPath}:${volume.id}`,
                    scope: dirPath,
                })
            } catch (cause) {
                toastError(cause)
            }
        }
        void run()
    }

    /** 删除确认框的目标卷与卷序：卷序用于展示「第N卷」而不是原始卷名 */
    const deletingVolume = workspace.volumes.find((volume) => volume.id === deletingVolumeId) ?? null
    const deletingVolumeIndex = workspace.volumes.findIndex((volume) => volume.id === deletingVolumeId)

    /** 清空确认框的目标卷与卷序：文案里带上章数，确认前看清要丢掉多少章纲 */
    const clearingVolume = workspace.volumes.find((volume) => volume.id === clearingVolumeId) ?? null
    const clearingVolumeIndex = workspace.volumes.findIndex((volume) => volume.id === clearingVolumeId)

    const handleConfirmDeleteVolume = (): void => {
        if (deletingVolume === null) {
            return
        }
        onApplyOutlineChange({
            volumes: workspace.volumes.filter((volume) => volume.id !== deletingVolume.id),
        })
        setDeletingVolumeId(null)
        // 删掉的卷里可能包含当前选中的章，清空选中让页面回落到首章
        setSelectedChapterId(null)
    }

    /**
     * 清空章纲：把该卷的章节条目全部移除，只保留卷纲；立即写盘，
     * 并清掉章节选中，避免选中项指向已被移除的章。
     */
    const handleConfirmClearChapters = (): void => {
        if (clearingVolume === null) {
            return
        }
        onApplyOutlineChange({
            volumes: workspace.volumes.map((volume) =>
                volume.id === clearingVolume.id ? { ...volume, chapters: [] } : volume,
            ),
        })
        setClearingVolumeId(null)
        setSelectedChapterId(null)
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
            return (
                <StructurePanel
                    acts={plan.acts}
                    volumeOptions={actVolumeOptions}
                    onChange={(acts) => onUpdatePlan('structure', { acts })}
                />
            )
        }
        if (module === 'clue') {
            return (
                <ClueTrackPanels
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
                <ChapterFocusView
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
            <ChapterDetail
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
                        {/* 页头只留一个新增入口：加什么由当前模块标签决定，不再开菜单选类型 */}
                        <Button onClick={addAction.onClick}>
                            {addAction.icon}
                            {addAction.label}
                        </Button>
                        <OutlineActionMenu
                            dirPath={dirPath}
                            isExtracting={isExtracting}
                            onExtract={handleExtract}
                            onGenerateVolumeOutlines={handleGenerateVolumeOutlines}
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
                    />
                </AppHeader>

                {/*
                 * 章纲页是三栏并列，必须由 AppContent 自身当 flex 容器（不能用 isScrollable：
                 * 它的内容壳是 flex-col，会把三栏竖排）；其余三页是单块内容，交给 isScrollable 的
                 * ScrollArea 统一滚动，避免各面板再各自挂 overflow 形成嵌套滚动。
                 */}
                {isChapterModule ? (
                    <AppContent className="flex">
                        <aside
                            className={cn(
                                'min-h-0 w-full overflow-y-auto px-2 py-2 @2xl:w-64 @2xl:shrink-0 @2xl:border-r @2xl:border-border',
                                isDrilldown && 'hidden @2xl:block',
                            )}
                        >
                            <ChapterTree
                                entries={treeEntries}
                                selectedChapterId={selectedChapterId}
                                hasAnyChapter={entries.length > 0}
                                isListFiltered={volumeFilter !== 'all' || query.trim().length > 0}
                                onSelectChapter={handleSelectChapter}
                            />
                        </aside>

                        <section
                            className={cn('min-h-0 w-full flex-1 overflow-hidden', !isDrilldown && 'hidden @2xl:block')}
                        >
                            {renderModule()}
                        </section>

                        {selectedEntry !== null && !isFocusOpen ? (
                            <aside className="hidden min-h-0 w-72 shrink-0 @4xl:flex">
                                <ChapterAiPanel
                                    setting={workspace.setting}
                                    volume={selectedEntry.volume}
                                    chapter={selectedEntry.chapter}
                                    characters={workspace.characters}
                                    onOpenChat={onOpenChat}
                                />
                            </aside>
                        ) : null}
                    </AppContent>
                ) : (
                    <AppContent isScrollable>
                        {module === 'volume' ? (
                            <VolumeCards
                                volumes={workspace.volumes}
                                setting={workspace.setting}
                                characters={workspace.characters}
                                onUpdate={onUpdateVolume}
                                onMoveUp={(volume) => handleMoveVolume(volume.id, -1)}
                                onMoveDown={(volume) => handleMoveVolume(volume.id, 1)}
                                onGenerateChapters={handleGenerateVolumeChapters}
                                onClearChapters={handleClearVolumeChapters}
                                onAddToChat={handleAddVolumeToChat}
                                onDelete={handleDeleteVolume}
                            />
                        ) : (
                            renderModule()
                        )}
                    </AppContent>
                )}
            </AppPage>

            <AlertDialog
                open={deletingVolume !== null}
                title="删除这一卷？"
                description={`「${volumeTitleLabel(deletingVolume?.name ?? '', deletingVolumeIndex < 0 ? 0 : deletingVolumeIndex)}」的卷纲与章节会从大纲中删除；Chapters 目录里的章节文件不会被删除。`}
                confirmLabel="删除"
                isDestructive
                onOpenChange={(isOpen) => {
                    if (!isOpen) {
                        setDeletingVolumeId(null)
                    }
                }}
                onConfirm={handleConfirmDeleteVolume}
            />

            <AlertDialog
                open={clearingVolume !== null}
                title="清空这一卷的章纲？"
                description={`「${volumeTitleLabel(clearingVolume?.name ?? '', clearingVolumeIndex < 0 ? 0 : clearingVolumeIndex)}」下的 ${String(clearingVolume?.chapters.length ?? 0)} 章会从大纲中移除，仅保留这一卷的卷纲；Chapters 目录里的章节文件不会被删除。`}
                confirmLabel="清空"
                isDestructive
                onOpenChange={(isOpen) => {
                    if (!isOpen) {
                        setClearingVolumeId(null)
                    }
                }}
                onConfirm={handleConfirmClearChapters}
            />

            <AlertDialog
                open={isOutlinesConfirmOpen}
                title="覆盖现有卷纲？"
                description={`将按作品设定重新生成卷纲，现有 ${String(workspace.volumes.length)} 卷的卷纲会被覆盖；卷内章节、节拍与场景不受影响。`}
                confirmLabel="继续生成"
                isDestructive
                onOpenChange={setIsOutlinesConfirmOpen}
                onConfirm={() => {
                    setIsOutlinesConfirmOpen(false)
                    setIsOutlinesOpen(true)
                }}
            />

            {/* key 绑定打开状态：每次重新打开都重建对话框，草案与勾选不会从上一次带过来 */}
            <VolumeGenerateOutlinesDialog
                key={isOutlinesOpen ? 'outlines-open' : 'outlines-closed'}
                isOpen={isOutlinesOpen}
                onOpenChange={setIsOutlinesOpen}
                setting={workspace.setting}
                characters={workspace.characters}
                existingNames={workspace.volumes.map((volume) => volume.name)}
                acts={actContexts}
                onApply={onApplyVolumeOutlines}
            />

            <ChapterBackfillDialog
                isOpen={isBackfillOpen}
                onOpenChange={setIsBackfillOpen}
                dirPath={dirPath}
                volumes={workspace.volumes}
                plan={plan}
                characters={workspace.characters}
                onApply={onApplyOutlineChange}
            />

            {/* key 绑定打开状态：每次重新打开都重建对话框，草案、勾选与章数不会从上一次带过来 */}
            <VolumeGenerateChaptersDialog
                key={isGenerateOpen ? 'generate-open' : 'generate-closed'}
                isOpen={isGenerateOpen && generatingVolume !== null}
                onOpenChange={setIsGenerateOpen}
                volume={generatingVolume}
                setting={workspace.setting}
                characters={workspace.characters}
                acts={actContexts}
                clues={generatingVolumeClues}
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
                            clueRefs: draft.clueRefs,
                        })),
                        mode,
                    )
                }}
            />
        </>
    )
}
