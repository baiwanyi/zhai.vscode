/**
 * 写前查纲面板：以只读卡片呈现卷纲上下文、本章章纲、卡文自查、场景、伏笔与前后章关系，并列出将注入 AI 对话的引用。
 * 复用约定：分区容器取 @components/ui 的 card / item，卷纲要点逐行折叠取 collapsible；
 * 前后章位置取 item 分组、图标与分隔，场景与伏笔明细取 item 分组；
 * 状态与钩子文案取 constants 元数据表，设定约束与地点条目由调用方按当前章传入。
 * 关键约束：全部只读、不改章纲数据；「本次引用」只作展示，实际注入由对话框底部的「添加到AI对话」动作完成。
 */
import type {
    CharacterCard,
    LoreEntry,
    OutlineChapter,
    OutlineChapterRef,
    OutlinePlan,
    OutlineVolume,
    ProjectSetting,
} from '../../types'
import type { JSX } from 'react'
import { ChapterFocusBlockerCheckCard } from '../block/ChapterFocusBlockerCheckCard'
import { ChapterFocusBriefCard } from '../block/ChapterFocusBriefCard'
import { ChapterFocusClueListCard } from '../block/ChapterFocusClueListCard'
import { ChapterFocusReferenceCard } from '../block/ChapterFocusReferenceCard'
import { ChapterFocusSceneListCard } from '../block/ChapterFocusSceneListCard'
import { ChapterFocusVolumeContextCard } from '../block/ChapterFocusVolumeContextCard'
import { buildChapterFocusData } from '../utils/chapterFocusSnapshot'

interface ChapterFocusPanelProps {
    setting: ProjectSetting
    volume: OutlineVolume
    chapter: OutlineChapter
    chapterRef: OutlineChapterRef
    characters: CharacterCard[]
    /** 设定页地点条目：按本章地点匹配后计入注入的设定约束 */
    lore: readonly LoreEntry[]
    plan: OutlinePlan
    prevChapter: OutlineChapter | null
    nextChapter: OutlineChapter | null
    nextChapters: OutlineChapter[]
}

/** 写前查纲：只盯当前章与其前后章关系，只读卡片辅助卡文时排查 */
export function ChapterFocusPanel({
    setting,
    volume,
    chapter,
    chapterRef,
    characters,
    lore,
    plan,
    prevChapter,
    nextChapter,
    nextChapters,
}: ChapterFocusPanelProps): JSX.Element {
    const { cast, hookLabel, relatedClues, characterLabel, settingLabel, constraintLabel } = buildChapterFocusData({
        setting,
        chapter,
        chapterRef,
        characters,
        plan,
        lore,
    })

    return (
        <section className="flex flex-col gap-3 p-1">
            <ChapterFocusVolumeContextCard
                volume={volume}
                prevChapter={prevChapter}
                nextChapter={nextChapter}
                nextChapters={nextChapters}
            />
            <ChapterFocusBriefCard chapter={chapter} hookLabel={hookLabel} />
            <ChapterFocusBlockerCheckCard cast={cast} chapter={chapter} hookLabel={hookLabel} />
            {chapter.scenes.length > 0 ? <ChapterFocusSceneListCard scenes={chapter.scenes} /> : null}
            {relatedClues.length > 0 ? (
                <ChapterFocusClueListCard clues={relatedClues} chapterRef={chapterRef} />
            ) : null}
            <ChapterFocusReferenceCard
                volume={volume}
                chapter={chapter}
                characterLabel={characterLabel}
                settingLabel={settingLabel}
                constraintLabel={constraintLabel}
            />
        </section>
    )
}
