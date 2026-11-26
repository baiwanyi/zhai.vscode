/**
 * 写后回填纯计算：事实差异筛选、回填后卷章与伏笔计划推导、勾选建议的合法性校验。
 * 复用约定：章节引用键统一走「卷序-章序」口径，与伏笔 plant/payoff 及章节引用选项一致；
 * 卷章树经 press/utils 的 createChapterRefEntries 展开，展示格式走 formatChapterRefLabel。
 * 关键约束：纯函数不写盘、不读外部状态；只覆盖 actualSummary / wordCount 与伏笔引用，成长线只追加；
 * 计划梗概保持原样；AI 建议坐标须在现有卷章内才写入，防幻觉引用。
 */
import type { ClueRefSuggestion, GrowthPointSuggestion } from '@shared/types/press'
import type { GrowthPoint, OutlineChapter, OutlineClue, OutlinePlan, OutlineVolume } from '../../types'
import { createChapterRefEntries } from '../../utils'

/** 一行回填差异：章纲计划与章节事实并排放，供作者逐项确认 */
export interface BackfillRow {
    chapter: OutlineChapter
    volumeName: string
    factSummary: string
    factWordCount: number
    hasSummaryChange: boolean
    hasWordCountChange: boolean
}

/** 章节事实：宿主读取的单章实际摘要与字数 */
export interface ChapterFact {
    volumeOrder: number
    chapterIndex: number
    summary: string
    wordCount: number
}

/** 回填输入：全部派生值一次传入，函数内不再读 hook 或外部状态 */
export interface ApplyBackfillInput {
    volumes: readonly OutlineVolume[]
    plan: OutlinePlan
    rows: readonly BackfillRow[]
    selectedChapterIds: readonly string[]
    clueSelection: readonly string[]
    suggestions: readonly ClueRefSuggestion[]
    acceptedRefKeys: readonly string[]
    /** 成长节点建议：已采纳的按坐标追加到成长线 */
    growthSuggestions: readonly GrowthPointSuggestion[]
    acceptedGrowthKeys: readonly string[]
    knownRefKeys: ReadonlySet<string>
}

/** 回填输出：交页面写盘的整批卷章与伏笔计划 */
export interface BackfillResult {
    volumes: OutlineVolume[]
    plan: OutlinePlan
}

/** 建议键：与宿主去重同口径（id:action） */
export function refKey(suggestion: { id: string; action: 'plant' | 'payoff' }): string {
    return `${suggestion.id}:${suggestion.action}`
}

/** 成长建议键：同章同轨道只有一条，与宿主去重口径一致 */
export function growthKey(suggestion: { track: string; volumeOrder: number; chapterOrder: number }): string {
    return `${suggestion.track}:${String(suggestion.volumeOrder)}-${String(suggestion.chapterOrder)}`
}

/** 回收章引用键：与章节引用选项一致，未定章返回 null */
export function payoffKey(clue: OutlineClue): string | null {
    return clue.payoff === null ? null : `${String(clue.payoff.volumeOrder)}-${String(clue.payoff.chapterOrder)}`
}

/** 已写章节的引用键集合：按正文字数判定，作为伏笔自动回收的判定依据 */
export function collectWrittenRefs(volumes: readonly OutlineVolume[]): Set<string> {
    return new Set(
        createChapterRefEntries(volumes)
            .filter((entry) => entry.chapter.wordCount > 0)
            .map((entry) => `${String(entry.ref.volumeOrder)}-${String(entry.ref.chapterOrder)}`),
    )
}

/** 合法章坐标集合：只接受当前作品真实存在的卷章 */
export function collectKnownRefKeys(volumes: readonly OutlineVolume[]): Set<string> {
    return new Set(
        createChapterRefEntries(volumes).map(
            (entry) => `${String(entry.ref.volumeOrder)}-${String(entry.ref.chapterOrder)}`,
        ),
    )
}

/** 伏笔是否应自动标记已回收：回收章正文已写完且伏笔仍未回收 */
export function shouldAutoPaidOff(clue: OutlineClue, writtenRefs: ReadonlySet<string>): boolean {
    const key = payoffKey(clue)
    return clue.status === 'planted' && key !== null && writtenRefs.has(key)
}

/**
 * 事实差异筛选：按「卷序 + 卷内位置」匹配章节事实，只保留摘要或字数有变化的章。
 * 关键约束：事实摘要为空不算变化，避免读取失败把章纲梗概抹成空串。
 */
export function buildBackfillRows(facts: readonly ChapterFact[], volumes: readonly OutlineVolume[]): BackfillRow[] {
    const factByPosition = new Map(
        facts.map((fact) => [`${String(fact.volumeOrder)}-${String(fact.chapterIndex)}`, fact]),
    )
    return createChapterRefEntries(volumes).flatMap((entry) => {
        const fact = factByPosition.get(`${String(entry.ref.volumeOrder)}-${String(entry.chapterIndex)}`)
        if (fact === undefined) {
            return []
        }
        const hasSummaryChange =
            fact.summary.trim().length > 0 && fact.summary.trim() !== entry.chapter.actualSummary.trim()
        const hasWordCountChange = fact.wordCount !== entry.chapter.wordCount
        if (!hasSummaryChange && !hasWordCountChange) {
            return []
        }
        return [
            {
                chapter: entry.chapter,
                volumeName: entry.volume.name,
                factSummary: fact.summary,
                factWordCount: fact.wordCount,
                hasSummaryChange,
                hasWordCountChange,
            },
        ]
    })
}

/** 回填后的卷章：只改被勾选且有差异的章，其余原样返回 */
export function buildNextVolumes(
    volumes: readonly OutlineVolume[],
    rows: readonly BackfillRow[],
    selectedChapterIds: readonly string[],
): OutlineVolume[] {
    return volumes.map((volume) => ({
        ...volume,
        chapters: volume.chapters.map((chapter) => {
            const row = rows.find((item) => item.chapter.id === chapter.id)
            if (row === undefined || !selectedChapterIds.includes(chapter.id)) {
                return chapter
            }
            return {
                ...chapter,
                actualSummary: row.factSummary.trim().length > 0 ? row.factSummary : chapter.actualSummary,
                wordCount: row.factWordCount,
            }
        }),
    }))
}

/**
 * 应用回填：产出整批卷章与伏笔计划，交页面写盘。
 * 关键约束：只对 still-planted 的伏笔写引用，不覆盖已填的 plant/payoff；
 * AI 建议坐标不在 knownRefKeys 内时跳过，防幻觉引用落盘。
 */
export function applyBackfill({
    volumes,
    plan,
    rows,
    selectedChapterIds,
    clueSelection,
    suggestions,
    acceptedRefKeys,
    growthSuggestions,
    acceptedGrowthKeys,
    knownRefKeys,
}: ApplyBackfillInput): BackfillResult {
    const nextVolumes = buildNextVolumes(volumes, rows, selectedChapterIds)
    const nextWrittenRefs = collectWrittenRefs(nextVolumes)
    const accepted = new Set(acceptedRefKeys)
    const nextPlan: OutlinePlan = {
        ...plan,
        clues: plan.clues.map((clue) => {
            const isChecked = clueSelection.includes(clue.id)
            const shouldPaidOff = clue.status === 'planted' && (isChecked || shouldAutoPaidOff(clue, nextWrittenRefs))
            let next: OutlineClue = shouldPaidOff ? { ...clue, status: 'paid-off' } : clue
            for (const suggestion of suggestions) {
                if (
                    suggestion.id !== clue.id ||
                    !accepted.has(refKey(suggestion)) ||
                    !knownRefKeys.has(`${String(suggestion.volumeOrder)}-${String(suggestion.chapterOrder)}`)
                ) {
                    continue
                }
                const ref = { volumeOrder: suggestion.volumeOrder, chapterOrder: suggestion.chapterOrder }
                if (suggestion.action === 'plant' && next.plant === null) {
                    next = { ...next, plant: ref }
                } else if (suggestion.action === 'payoff' && next.payoff === null) {
                    next = { ...next, payoff: ref }
                }
            }
            return next
        }),
    }
    // 成长线只追加：坐标须在现有卷章内，且同章同轨道不重复；不改动其它卷已有节点
    const acceptedGrowth = new Set(acceptedGrowthKeys)
    const usedGrowthKeys = new Set(
        plan.growth.map(
            (point) => `${point.track}:${String(point.volumeOrder)}-${String(point.chapterOrder ?? '')}`,
        ),
    )
    const appendedGrowth: GrowthPoint[] = []
    for (const suggestion of growthSuggestions) {
        if (
            !acceptedGrowth.has(growthKey(suggestion)) ||
            !knownRefKeys.has(`${String(suggestion.volumeOrder)}-${String(suggestion.chapterOrder)}`)
        ) {
            continue
        }
        const key = growthKey(suggestion)
        if (usedGrowthKeys.has(key)) {
            continue
        }
        usedGrowthKeys.add(key)
        appendedGrowth.push({
            id: `growth-${String(suggestion.volumeOrder)}-${String(suggestion.chapterOrder)}-${suggestion.track}`,
            volumeOrder: suggestion.volumeOrder,
            chapterOrder: suggestion.chapterOrder,
            track: suggestion.track,
            value: suggestion.value,
            note: suggestion.note,
        })
    }
    return {
        volumes: nextVolumes,
        plan: { ...nextPlan, growth: [...plan.growth, ...appendedGrowth] },
    }
}
