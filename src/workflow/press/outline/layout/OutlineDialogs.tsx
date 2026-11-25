/**
 * 大纲工作台对话框组：集中挂载删除/清空/覆盖确认框与卷纲、章纲两类生成弹窗。
 * 复用约定：动作由调用方以回调传入，本组件只负责开合状态与数据透传；对话框 key 绑定打开状态，
 * 重开时重建以避免草稿与勾选残留；uri 等去重键仍由事件 Hook 在提交时生成。
 * 关键约束：删除与清空只移除大纲条目、不碰 Chapters 文件；覆盖确认只影响卷纲字段、保留章节；
 * 生成章纲的目标卷由调用方定位，本组件不自行推断，避免与页头卷筛选串台。
 */
import type { OutlineActContext, OutlineClueContext, VolumeOutlineDraft } from '@shared/types/press'
import { AlertDialog } from '@webview/components/AlertDialog'
import { VolumeGenerateChaptersDialog } from './VolumeGenerateChaptersDialog'
import { VolumeGenerateOutlinesDialog } from './VolumeGenerateOutlinesDialog'
import type { CharacterCard, OutlineVolume, ProjectSetting } from '../../types'
import type { ChapterSeed, VolumeChapterWriteMode } from '../../utils'
import type { OutlinePageActions } from '../hooks/useOutlinePageActions'
import type { JSX } from 'react'
import { volumeTitleLabel } from '../../utils'

interface OutlineDialogsProps {
    volumes: OutlineVolume[]
    setting: ProjectSetting
    characters: CharacterCard[]
    acts: readonly OutlineActContext[]
    generatingClues: readonly OutlineClueContext[]
    actions: OutlinePageActions
    onApplyVolumeOutlines: (drafts: readonly VolumeOutlineDraft[]) => number
    onApplyVolumeChapters: (volumeId: string, seeds: readonly ChapterSeed[], mode: VolumeChapterWriteMode) => number
}

export function OutlineDialogs({
    volumes,
    setting,
    characters,
    acts,
    generatingClues,
    actions,
    onApplyVolumeOutlines,
    onApplyVolumeChapters,
}: OutlineDialogsProps): JSX.Element {
    return (
        <>
            <AlertDialog
                open={actions.deletingVolume !== null}
                title="删除这一卷？"
                description={`「${volumeTitleLabel(actions.deletingVolume?.name ?? '', actions.deletingVolumeIndex < 0 ? 0 : actions.deletingVolumeIndex)}」的卷纲与章节会从大纲中删除；Chapters 目录里的章节文件不会被删除。`}
                confirmLabel="删除"
                isDestructive
                onOpenChange={(isOpen) => {
                    if (!isOpen) {
                        actions.setDeletingVolumeId(null)
                    }
                }}
                onConfirm={actions.handleConfirmDeleteVolume}
            />

            <AlertDialog
                open={actions.clearingVolume !== null}
                title="清空这一卷的章纲？"
                description={`「${volumeTitleLabel(actions.clearingVolume?.name ?? '', actions.clearingVolumeIndex < 0 ? 0 : actions.clearingVolumeIndex)}」下的 ${String(actions.clearingVolume?.chapters.length ?? 0)} 章会从大纲中移除，仅保留这一卷的卷纲；Chapters 目录里的章节文件不会被删除。`}
                confirmLabel="清空"
                isDestructive
                onOpenChange={(isOpen) => {
                    if (!isOpen) {
                        actions.setClearingVolumeId(null)
                    }
                }}
                onConfirm={actions.handleConfirmClearChapters}
            />

            <AlertDialog
                open={actions.isOutlinesConfirmOpen}
                title="覆盖现有卷纲？"
                description={`将按作品设定重新生成卷纲，现有 ${String(volumes.length)} 卷的卷纲会被覆盖；卷内章节、节拍与场景不受影响。`}
                confirmLabel="继续生成"
                isDestructive
                onOpenChange={actions.setIsOutlinesConfirmOpen}
                onConfirm={actions.confirmOutlinesOverwrite}
            />

            {/* key 绑定打开状态：每次重新打开都重建对话框，草案与勾选不会从上一次带过来 */}
            <VolumeGenerateOutlinesDialog
                key={actions.isOutlinesOpen ? 'outlines-open' : 'outlines-closed'}
                isOpen={actions.isOutlinesOpen}
                onOpenChange={actions.setIsOutlinesOpen}
                setting={setting}
                characters={characters}
                existingNames={volumes.map((volume) => volume.name)}
                acts={acts}
                onApply={onApplyVolumeOutlines}
            />

            {/* key 绑定打开状态：每次重新打开都重建对话框，草案、勾选与章数不会从上一次带过来 */}
            <VolumeGenerateChaptersDialog
                key={actions.isGenerateOpen ? 'generate-open' : 'generate-closed'}
                isOpen={actions.isGenerateOpen && actions.generatingVolume !== null}
                onOpenChange={actions.setIsGenerateOpen}
                volume={actions.generatingVolume}
                setting={setting}
                characters={characters}
                acts={acts}
                clues={generatingClues}
                onApply={(drafts, mode) => {
                    if (actions.generatingVolume === null) {
                        return 0
                    }
                    return onApplyVolumeChapters(
                        actions.generatingVolume.id,
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
