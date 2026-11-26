/**
 * 章纲编辑面板：组合元信息、章纲卡、节拍与场景四块表单，改动只经 onChange 回传章纲补丁。
 * 复用约定：字段与交互拆到 block/ChapterEditMetaFields / 同目录 ChapterEditCardFields / ChapterEditBeatCard / block/ChapterEditSceneCard，
 * 事件归一走 useChapterFieldHandlers 与 useChapterSceneHandlers，派生值走 outline/utils 的 chapterEditFields；
 * 字数口径复用 press/utils 的 formatWordCount。
 * 关键约束：阶段只从传入的 stageNames 取选项，哨兵值由本文件定义并传给元信息字段；
 * 生成状态由调用方持有并以 summaryGeneration 注入，本面板不发起 AI 请求、不直接落库。
 */
import { ChapterEditBeatCard } from './ChapterEditBeatCard'
import { ChapterEditCardFields } from './ChapterEditCardFields'
import type { OptionMeta } from '../../constants'
import type { CharacterCard, LoreEntry, OutlineChapter } from '../../types'
import type { JSX } from 'react'
import { TENSION_LABELS } from '../../constants'
import { ChapterEditMetaFields } from '../block/ChapterEditMetaFields'
import { ChapterEditSceneCard } from '../block/ChapterEditSceneCard'
import { useChapterFieldHandlers } from '../hooks/useChapterFieldHandlers'
import { useChapterSceneHandlers } from '../hooks/useChapterSceneHandlers'
import { buildStageOptions, computeChapterProgress } from '../utils/chapterEditFields'

interface SummaryGeneration {
    isGenerating: boolean
    onGenerate: () => void
}

interface ChapterEditPanelProps {
    chapter: OutlineChapter
    characters: CharacterCard[]
    /** 设定页地点条目：供章纲卡的场景地点选取 */
    lore: readonly LoreEntry[]
    /** 单章目标字数：取自作品设定，进度计算与展示共用 */
    chapterWordGoal: number
    /** 结构纲阶段名：由调用方从 plan.acts 映射，面板不再依赖整个 OutlinePlan */
    stageNames: readonly string[]
    summaryGeneration: SummaryGeneration
    onChange: (patch: Partial<OutlineChapter>) => void
}

/**
 * 阶段下拉的「未分组」哨兵：Radix Select 不接受空串 value，回传时再折回空串。
 * 用控制字符前缀确保与阶段名的值域不相交，避免同名阶段被静默折成未分组。
 */
const STAGE_NONE_VALUE = '\u0000none'

/** 章纲编辑：组合四块表单，字段改动统一回传补丁 */
export function ChapterEditPanel({
    chapter,
    characters,
    lore,
    chapterWordGoal,
    stageNames,
    summaryGeneration,
    onChange,
}: ChapterEditPanelProps): JSX.Element {
    const { writtenWords, progress } = computeChapterProgress(chapter.wordCount, chapterWordGoal)
    const tensionLabel = TENSION_LABELS[chapter.tension - 1] ?? ''
    /** 结构纲阶段名 + 本章已有自定义值：历史阶段不因下拉切换而显示空白 */
    const stageValues = buildStageOptions(stageNames, chapter.stage)
    const stageOptions: OptionMeta<string>[] = [
        { value: STAGE_NONE_VALUE, label: '未分组' },
        ...stageValues.map((name) => ({ value: name, label: name })),
    ]

    const { handleHookChange, handlePacingChange } = useChapterFieldHandlers(onChange)
    const { handleAddScene, handleScenePatch, handleRemoveScene } = useChapterSceneHandlers(chapter.scenes, onChange)

    return (
        <section className="flex flex-col flex-1 gap-3 p-1">
            <ChapterEditMetaFields
                chapter={chapter}
                stageOptions={stageOptions}
                stageNoneValue={STAGE_NONE_VALUE}
                isGeneratingSummary={summaryGeneration.isGenerating}
                onGenerateSummary={summaryGeneration.onGenerate}
                onChange={onChange}
            />

            <ChapterEditCardFields
                chapter={chapter}
                characters={characters}
                lore={lore}
                tensionLabel={tensionLabel}
                chapterWordGoal={chapterWordGoal}
                writtenWords={writtenWords}
                progress={progress}
                onHookChange={handleHookChange}
                onPacingChange={handlePacingChange}
                onChange={onChange}
            />

            <ChapterEditBeatCard beats={chapter.beats} onChange={(beats) => onChange({ beats })} />

            <ChapterEditSceneCard
                scenes={chapter.scenes}
                onAdd={handleAddScene}
                onPatch={handleScenePatch}
                onRemove={handleRemoveScene}
            />
        </section>
    )
}
