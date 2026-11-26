/**
 * 写前查纲面板的纯函数：把章纲、人物与伏笔装配成各卡片可直接消费的只读快照与文案。
 * 复用约定：钩子文案取 constants 元数据表，伏笔按章引用复用 press/utils 的匹配函数，
 * 设定约束复用 press/utils 的 buildSettingConstraints，章节标题沿用 chapterTitleLabel 口径。
 * 关键约束：出场人物与「本次引用」共用同一份 cast，空章引用由调用方给出明确回退文案；
 * 设定约束标签只列注入项名称，正文拼装与实际注入在 formatChapterOutlineText 内统一完成。
 */
import type {
    CharacterCard,
    LoreEntry,
    OutlineChapter,
    OutlineChapterRef,
    OutlineClue,
    OutlinePlan,
    ProjectSetting,
} from '../../types'
import { HOOK_OPTIONS } from '../../constants'
import { buildSettingConstraints, chapterTitleLabel, findCluesByChapterRef } from '../../utils'

interface ChapterFocusDataInput {
    setting: ProjectSetting
    chapter: OutlineChapter
    chapterRef: OutlineChapterRef
    characters: readonly CharacterCard[]
    plan: OutlinePlan
    lore?: readonly LoreEntry[]
}

interface ChapterFocusData {
    cast: CharacterCard[]
    hookLabel: string
    relatedClues: OutlineClue[]
    characterLabel: string
    settingLabel: string
    constraintLabel: string
}

/** 一次算出聚焦面板全部衍生值，避免主组件内多处筛选与文案拼装 */
export function buildChapterFocusData({
    setting,
    chapter,
    chapterRef,
    characters,
    plan,
    lore = [],
}: ChapterFocusDataInput): ChapterFocusData {
    const cast = characters.filter((character) => chapter.characterIds.includes(character.id))
    const hookLabel = HOOK_OPTIONS.find((option) => option.value === chapter.hook)?.label ?? '无'
    const characterLabel =
        cast.length > 0 ? cast.map((character) => character.name).join('、') : '未指定出场人物'
    const settingLabel = `${setting.genres.join(' / ') || '未填题材'} · ${setting.tone || '未填风格'}`
    const constraints = buildSettingConstraints(chapter, setting, lore)
    return {
        cast,
        hookLabel,
        relatedClues: findCluesByChapterRef(plan.clues, chapterRef),
        characterLabel,
        settingLabel,
        constraintLabel: constraints.length > 0 ? constraints.map((item) => item.label).join('、') : '未填相关设定',
    }
}

/** 前后章一行：空引用直接回退，非空才计算明细，避免空引用时读取章节字段 */
export function chapterReferenceLabel(
    chapter: OutlineChapter | null,
    emptyText: string,
    detail: (chapter: OutlineChapter) => string,
): string {
    if (chapter === null) {
        return emptyText
    }
    return `${chapterTitleLabel(chapter)}：${detail(chapter)}`
}
