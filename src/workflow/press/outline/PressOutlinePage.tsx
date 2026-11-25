/**
 * 大纲工作台：卷纲 / 章纲 / 结构 / 伏笔四模块的装配与导航。
 * 复用约定：外壳取 @webview/components/AppPage，详情、章节列表、筛选与对话框分别取 ./layout 下对应组件。
 * 关键约束：模块切换只切视图；各面板只写自己段落；生成卷章时把结构与本卷伏笔作为约束传入，
 * 草案里的伏笔关联在写入时按实际章序回写伏笔表；清空章纲只删条目、不碰 Chapters 文件。
 */
import { FilePlus, Layers, Lightbulb, ListPlus } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { PressExtractedVolume, VolumeOutlineDraft } from '@shared/types/press'
import { AppPage } from '@webview/components/AppPage'
import { useOutlineDerived } from './hooks/useOutlineDerived'
import { useOutlineExtract } from './hooks/useOutlineExtract'
import { useOutlinePageActions } from './hooks/useOutlinePageActions'
import { OutlineBody } from './layout/OutlineBody'
import { OutlineDialogs } from './layout/OutlineDialogs'
import { OutlineHeader } from './layout/OutlineHeader'
import type { CreatedOutlineNode } from '../hooks/usePressMutations'
import type {
    OutlineChapter,
    OutlineExtractTarget,
    OutlineGranularity,
    OutlineModuleKey,
    OutlinePlan,
    OutlineSectionKey,
    OutlineVolume,
    OutlineWorkspace,
} from '../types'
import type { ChapterSeed, VolumeChapterWriteMode } from '../utils'
import type { JSX, ReactNode } from 'react'
import { useOpenProjectDoc } from '../hooks/useOpenProjectDoc'
import { toVolumeClueContexts } from '../utils'

/** 各模块「新增」按钮的固定文案与图标：与 onClick 解耦，避免每次渲染重建 JSX 元素 */
const ADD_ACTION_META: Record<OutlineModuleKey, { label: string; icon: ReactNode }> = {
    volume: { label: '新增卷', icon: <Layers /> },
    chapter: { label: '添加章节', icon: <FilePlus /> },
    structure: { label: '添加阶段', icon: <ListPlus /> },
    clue: { label: '添加伏笔', icon: <Lightbulb /> },
}

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
}: PressOutlinePageProps): JSX.Element {
    const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null)
    const [module, setModule] = useState<OutlineModuleKey>('volume')
    /** 颗粒度视图已取消筛选入口，固定为中纲：仅作为渲染粒度传给章纲详情与 AI 面板条件 */
    const granularity: OutlineGranularity = 'medium'
    /** 当前卷：'all' 为全部卷，否则为卷 id；兼作卷纲视图的开关，同时收窄左侧章节列表 */
    const [volumeFilter, setVolumeFilter] = useState('all')
    /** 标题搜索词：与卷筛选叠加，只收窄左侧列表 */
    const [query, setQuery] = useState('')
    const extractState = useOutlineExtract(dirPath)
    const { openDoc } = useOpenProjectDoc(dirPath)

    const plan = workspace.plan
    const derived = useOutlineDerived({ workspace, selectedChapterId, volumeFilter, query })
    const {
        entries,
        selectedEntry,
        summary,
        donePercent,
        volumeOptions,
        clueWarnings,
        refOptions,
        refEntries,
        actVolumeOptions,
        treeEntries,
        hasVolumeOutline,
        actContexts,
    } = derived

    const actions = useOutlinePageActions({
        workspace,
        dirPath,
        selectedChapterId,
        selectedEntry,
        volumeFilter,
        hasVolumeOutline,
        extractState,
        setSelectedChapterId,
        setModule,
        setVolumeFilter,
        setQuery,
        onCreateVolume,
        onCreateChapter,
        onUpdatePlan,
        onApplyOutlineChange,
        onExtractOutline,
    })

    /** 本卷伏笔：只取埋设或回收落在本卷的条目，依赖 actions 定位目标卷 */
    const generatingVolumeClues = useMemo(
        () =>
            actions.generatingVolume === null
                ? []
                : toVolumeClueContexts(plan.clues, workspace.volumes, actions.generatingVolume.id),
        [actions.generatingVolume, plan.clues, workspace.volumes],
    )

    /**
     * 页头唯一的新增入口：动作跟随当前模块标签——卷纲加卷、章纲加章、结构加阶段、伏笔加伏笔
     */
    const addActionHandlers: Record<OutlineModuleKey, () => void> = {
        volume: actions.handleCreateVolume,
        chapter: actions.handleCreateChapter,
        structure: actions.handleCreateAct,
        clue: actions.handleCreateClue,
    }
    const addAction = ADD_ACTION_META[module]

    return (
        <>
            <AppPage>
                <OutlineHeader
                    dirPath={dirPath}
                    volumes={workspace.volumes}
                    plan={plan}
                    characters={workspace.characters}
                    title={workspace.setting.title}
                    volumeCount={workspace.volumes.length}
                    module={module}
                    volumeFilter={volumeFilter}
                    query={query}
                    volumeOptions={volumeOptions}
                    summary={summary}
                    donePercent={donePercent}
                    isExtracting={extractState.isExtracting}
                    addAction={addAction}
                    onAddAction={addActionHandlers[module]}
                    onOpenDoc={() => openDoc('outline')}
                    onExtract={actions.handleExtract}
                    onGenerateVolumeOutlines={actions.handleGenerateVolumeOutlines}
                    onApplyBackfill={onApplyOutlineChange}
                    onModuleChange={(next) => {
                        setModule(next)
                        setSelectedChapterId(null)
                    }}
                    onVolumeChange={actions.handleVolumeChange}
                    onQueryChange={setQuery}
                />

                <OutlineBody
                    module={module}
                    workspace={workspace}
                    actions={actions}
                    entries={entries}
                    selectedEntry={selectedEntry}
                    selectedChapterId={selectedChapterId}
                    treeEntries={treeEntries}
                    refEntries={refEntries}
                    refOptions={refOptions}
                    clueWarnings={clueWarnings}
                    actVolumeOptions={actVolumeOptions}
                    volumeFilter={volumeFilter}
                    query={query}
                    granularity={granularity}
                    setSelectedChapterId={setSelectedChapterId}
                    onUpdatePlan={onUpdatePlan}
                    onUpdateChapter={onUpdateChapter}
                    onUpdateVolume={onUpdateVolume}
                />
            </AppPage>

            <OutlineDialogs
                volumes={workspace.volumes}
                setting={workspace.setting}
                characters={workspace.characters}
                acts={actContexts}
                generatingClues={generatingVolumeClues}
                actions={actions}
                onApplyVolumeOutlines={onApplyVolumeOutlines}
                onApplyVolumeChapters={onApplyVolumeChapters}
            />
        </>
    )
}
