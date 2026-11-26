/**
 * 大纲主体内容区：按当前模块在卷卡片、章纲列表、结构面板、伏笔面板与成长面板间分发，统一挂在单一滚动容器内。
 * 复用约定：各面板与 ChapterPanels 均取同目录组件，章节引用/上下章由 ../utils 的 resolveChapterViewContext 解析；
 * 章纲详情以全屏 Dialog 承载，编辑/查纲/回填三页签在对话框内切换，开合由选中章节驱动。
 * 关键约束：每个模块只写自己段落，分支必须显式判断，不能用 else 兜底新模块；
 * 模块切换的选中清理由页面回调负责，本组件只决定渲染分支；
 * 列表只负责选章，对话框关闭仅通知外部清选中；切章以章节 id 作 key 重建对话框，清空回填勾选。
 */
import { AppContent } from '@webview/components/AppPage'
import { ChapterEditDialog } from './ChapterEditDialog'
import { ChapterPanels } from './ChapterPanels'
import { ClueTrackPanels } from './ClueTrackPanels'
import { GrowthPanels } from './GrowthPanels'
import { StructurePanel } from './StructureActPanels'
import { VolumeCards } from './VolumeCards'
import type {
    OutlineChapter,
    OutlineModuleKey,
    OutlinePlan,
    OutlineSectionKey,
    OutlineTreeEntry,
    OutlineVolume,
    OutlineWorkspace,
} from '../../types'
import type { createChapterRefEntries, createChapterRefOptions, findClueWarnings } from '../../utils'
import type { OutlinePageActions } from '../hooks/useOutlinePageActions'
import type { JSX } from 'react'
import { resolveChapterViewContext } from '../../utils'

interface OutlineBodyProps {
    module: OutlineModuleKey
    workspace: OutlineWorkspace
    actions: OutlinePageActions
    entries: OutlineTreeEntry[]
    selectedEntry: OutlineTreeEntry | null
    selectedChapterId: string | null
    treeEntries: OutlineTreeEntry[]
    refEntries: ReturnType<typeof createChapterRefEntries>
    refOptions: ReturnType<typeof createChapterRefOptions>
    clueWarnings: ReturnType<typeof findClueWarnings>
    actVolumeOptions: { value: string; label: string }[]
    volumeFilter: string
    /** 修订标记筛选：'all' 或三态之一 */
    revisionFilter: string
    query: string
    setSelectedChapterId: (id: string | null) => void
    onUpdatePlan: (section: OutlineSectionKey, patch: Partial<OutlinePlan>) => void
    onUpdateChapter: (chapterId: string, patch: Partial<OutlineChapter>) => void
    onUpdateVolume: (volumeId: string, patch: Partial<OutlineVolume>) => void
}

export function OutlineBody({
    module,
    workspace,
    actions,
    entries,
    selectedEntry,
    selectedChapterId,
    treeEntries,
    refEntries,
    refOptions,
    clueWarnings,
    actVolumeOptions,
    volumeFilter,
    revisionFilter,
    query,
    setSelectedChapterId,
    onUpdatePlan,
    onUpdateChapter,
    onUpdateVolume,
}: OutlineBodyProps): JSX.Element {
    const plan = workspace.plan

    /** 结构/伏笔模块的详情区：每个面板只拿到自己那一段与对应的更新回调 */
    const renderPanel = (): JSX.Element => {
        if (module === 'structure') {
            return (
                <StructurePanel
                    acts={plan.acts}
                    volumeOptions={actVolumeOptions}
                    onChange={(acts) => onUpdatePlan('structure', { acts })}
                />
            )
        }
        if (module === 'growth') {
            return (
                <GrowthPanels
                    points={plan.growth}
                    volumes={workspace.volumes}
                    onChange={(growth) => onUpdatePlan('growth', { growth })}
                />
            )
        }
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

    /** 章纲模块：列表常驻，详情对话框以三页签承载编辑/查纲/回填 */
    const renderChapterBody = (): JSX.Element => {
        const chapterList = (
            <ChapterPanels
                entries={treeEntries}
                hasAnyChapter={entries.length > 0}
                isListFiltered={
                    volumeFilter !== 'all' || revisionFilter !== 'all' || query.trim().length > 0
                }
                onSelectChapter={actions.handleSelectChapter}
            />
        )
        if (selectedEntry === null) {
            return chapterList
        }
        const viewContext = resolveChapterViewContext(selectedEntry, workspace.volumes, refEntries)
        return (
            <>
                {chapterList}
                <ChapterEditDialog
                    key={selectedEntry.chapter.id}
                    open={selectedChapterId !== null}
                    onClose={() => setSelectedChapterId(null)}
                    setting={workspace.setting}
                    volume={selectedEntry.volume}
                    chapter={selectedEntry.chapter}
                    chapterRef={viewContext.chapterRef}
                    characters={workspace.characters}
                    lore={workspace.lore}
                    plan={plan}
                    prevChapter={viewContext.prevChapter}
                    nextChapter={viewContext.nextChapter}
                    nextChapters={viewContext.nextChapters}
                    onChange={(patch) => onUpdateChapter(selectedEntry.chapter.id, patch)}
                    onAddChapterToChat={actions.handleAddChapterToChat}
                />
            </>
        )
    }

    return (
        <AppContent isScrollable>
            {module === 'chapter' ? (
                renderChapterBody()
            ) : module === 'volume' ? (
                <VolumeCards
                    volumes={workspace.volumes}
                    setting={workspace.setting}
                    characters={workspace.characters}
                    plan={plan}
                    onUpdate={onUpdateVolume}
                    onMoveUp={(volume) => actions.handleMoveVolume(volume.id, -1)}
                    onMoveDown={(volume) => actions.handleMoveVolume(volume.id, 1)}
                    onGenerateChapters={actions.handleGenerateVolumeChapters}
                    onClearChapters={actions.handleClearVolumeChapters}
                    onAddToChat={actions.handleAddVolumeToChat}
                    onDelete={actions.handleDeleteVolume}
                    onNavigate={actions.handleOpenModule}
                />
            ) : (
                renderPanel()
            )}
        </AppContent>
    )
}
