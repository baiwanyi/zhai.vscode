/**
 * 写前查纲面板的纯函数：把章纲、人物与伏笔装配成各卡片可直接消费的只读快照与文案。
 * 复用约定：钩子文案取 constants 元数据表，伏笔按章引用复用 press/utils 的匹配函数，
 * 章节标题沿用 chapterTitleLabel 口径；不持有状态、不触碰写盘。
 * 关键约束：出场人物与「本次引用」共用同一份 cast，空章引用由调用方给出明确回退文案。
 */
import type {
    CharacterCard,
    OutlineChapter,
    OutlineChapterRef,
    OutlineClue,
    OutlinePlan,
    ProjectSetting,
} from '../../types'
import { HOOK_OPTIONS } from '../../constants'
import { chapterTitleLabel, findCluesByChapterRef } from '../../utils'

interface ChapterFocusDataInput {
    setting: ProjectSetting
    chapter: OutlineChapter
    chapterRef: OutlineChapterRef
    characters: readonly CharacterCard[]
    plan: OutlinePlan
}

interface ChapterFocusData {
    cast: CharacterCard[]
    hookLabel: string
    relatedClues: OutlineClue[]
    characterLabel: string
    settingLabel: string
}

/** 一次算出聚焦面板全部衍生值，避免主组件内多处筛选与文案拼装 */
export function buildChapterFocusData({
    setting,
    chapter,
    chapterRef,
    characters,
    plan,
}: ChapterFocusDataInput): ChapterFocusData {
    const cast = characters.filter((character) => chapter.characterIds.includes(character.id))
    const hookLabel = HOOK_OPTIONS.find((option) => option.value === chapter.hook)?.label ?? '无'
    const characterLabel =
        cast.length > 0 ? cast.map((character) => character.name).join('、') : '未指定出场人物'
    const settingLabel = `${setting.genres.join(' / ') || '未填题材'} · ${setting.tone || '未填风格'}`
    return {
        cast,
        hookLabel,
        relatedClues: findCluesByChapterRef(plan.clues, chapterRef),
        characterLabel,
        settingLabel,
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
