/**
 * 写后回填对话框：把章节文档的实际摘要与字数同步回章纲，按回收章完成情况标记伏笔回收，并按需追加成长节点。
 * 复用约定：统一对话框取 @webview/components/Dialog，四张区块卡取 block/ 展示块；事实读取与位置识别沿用专用 hooks，
 * 勾选状态取 useBackfillState，差异筛选与写盘结果计算取 outline/utils/backfill 纯函数，确认后由页面写盘。
 * 关键约束：只改大纲、不改章节正文；回收章正文已写完的伏笔自动回收，作者勾选作为兜底，未勾选的章不动；
 * 「计划梗概」永远不被覆盖——事实写进 actualSummary；AI 建议坐标须在现有卷章内才写入；
 * 成长线只追加已勾选的建议，不覆盖其它卷已有记录。
 */
import { useMemo } from 'react'
import { Dialog } from '@webview/components/Dialog'
import type { CharacterCard, OutlinePlan, OutlineVolume } from '../../types'
import type { JSX } from 'react'
import { BackfillChapterDiffCard } from '../block/BackfillChapterDiffCard'
import { BackfillClueRecoveryCard } from '../block/BackfillClueRecoveryCard'
import { BackfillClueSuggestionsCard } from '../block/BackfillClueSuggestionsCard'
import { BackfillGrowthSuggestionsCard } from '../block/BackfillGrowthSuggestionsCard'
import { useBackfillState } from '../hooks/useBackfillState'
import { useChapterFacts } from '../hooks/useChapterFacts'
import { useClueRefsAnalysis } from '../hooks/useClueRefsAnalysis'
import { useGrowthAnalysis } from '../hooks/useGrowthAnalysis'
import {
    applyBackfill,
    buildBackfillRows,
    buildNextVolumes,
    collectKnownRefKeys,
    collectWrittenRefs,
    growthKey,
    refKey,
    shouldAutoPaidOff,
} from '../utils/backfill'

interface BackfillClueDialogProps {
    isOpen: boolean
    onOpenChange: (isOpen: boolean) => void
    dirPath: string
    volumes: OutlineVolume[]
    plan: OutlinePlan
    characters: CharacterCard[]
    onApply: (next: { volumes: OutlineVolume[]; plan: OutlinePlan }) => void
}

export function BackfillClueDialog({
    isOpen,
    onOpenChange,
    dirPath,
    volumes,
    plan,
    characters,
    onApply,
}: BackfillClueDialogProps): JSX.Element {
    const { isLoading, facts, reload } = useChapterFacts(dirPath, isOpen)
    const { isAnalyzing, suggestions, analyze, clear } = useClueRefsAnalysis()
    const {
        isAnalyzing: isAnalyzingGrowth,
        suggestions: growthSuggestions,
        analyze: analyzeGrowth,
        clear: clearGrowth,
    } = useGrowthAnalysis()
    const state = useBackfillState()

    const rows = useMemo(() => buildBackfillRows(facts, volumes), [facts, volumes])
    const selectedChapterIds = state.selectedChapterIds(rows)
    const openedClues = useMemo(() => plan.clues.filter((clue) => clue.status === 'planted'), [plan.clues])
    const clueNameById = useMemo(() => new Map(plan.clues.map((clue) => [clue.id, clue.name])), [plan.clues])

    const nextVolumes = useMemo(
        () => buildNextVolumes(volumes, rows, selectedChapterIds),
        [volumes, rows, selectedChapterIds],
    )
    const nextWrittenRefs = useMemo(() => collectWrittenRefs(nextVolumes), [nextVolumes])
    const knownRefKeys = useMemo(() => collectKnownRefKeys(volumes), [volumes])
    const autoPaidCount = openedClues.filter((clue) => shouldAutoPaidOff(clue, nextWrittenRefs)).length

    const visibleSuggestions = useMemo(
        () =>
            suggestions.filter((suggestion) => {
                const clue = plan.clues.find((item) => item.id === suggestion.id)
                if (clue === undefined) {
                    return false
                }
                return suggestion.action === 'plant' ? clue.plant === null : clue.payoff === null
            }),
        [suggestions, plan.clues],
    )

    const canApply =
        rows.length > 0 ||
        state.clueSelection.length > 0 ||
        autoPaidCount > 0 ||
        visibleSuggestions.some((suggestion) => state.acceptedRefKeys.includes(refKey(suggestion))) ||
        growthSuggestions.some((suggestion) => state.acceptedGrowthKeys.includes(growthKey(suggestion)))

    const handleAnalyze = (): void => {
        void analyze(
            dirPath,
            plan.clues.map((clue) => ({ id: clue.id, name: clue.name, note: clue.note })),
        ).then((refs) => {
            state.acceptAll(refs.map(refKey))
        })
    }

    /** 成长线识别：把当前成长表作为去重参考，识别成功后默认勾选全部候选 */
    const handleAnalyzeGrowth = (): void => {
        void analyzeGrowth(
            dirPath,
            plan.growth.map((point) => ({ track: point.track, value: point.value })),
        ).then((points) => {
            state.acceptAllGrowth(points.map(growthKey))
        })
    }

    /** 关闭时清空全部本地勾选与识别结果，避免下次打开带入上次的中间状态 */
    const handleOpenChange = (nextOpen: boolean): void => {
        if (!nextOpen) {
            state.reset()
            clear()
            clearGrowth()
        }
        onOpenChange(nextOpen)
    }

    const handleApply = (): void => {
        const result = applyBackfill({
            volumes,
            plan,
            rows,
            selectedChapterIds,
            clueSelection: state.clueSelection,
            suggestions: visibleSuggestions,
            acceptedRefKeys: state.acceptedRefKeys,
            growthSuggestions,
            acceptedGrowthKeys: state.acceptedGrowthKeys,
            knownRefKeys,
        })
        onApply(result)
        handleOpenChange(false)
    }

    return (
        <Dialog
            open={isOpen}
            onOpenChange={handleOpenChange}
            title="写后回填"
            description="回填正文实际摘要与字数，确认已回收伏笔；不改章节正文"
            size="full"
            confirmLabel="回填所选"
            isDisabled={!canApply}
            onConfirm={handleApply}
        >
            <div className="flex flex-col gap-3">
                <BackfillChapterDiffCard
                    rows={rows}
                    selectedChapterIds={selectedChapterIds}
                    isLoading={isLoading}
                    onReload={reload}
                    onToggleChapter={(chapterId) => state.toggleChapter(chapterId, rows)}
                />
                <BackfillClueSuggestionsCard
                    suggestions={visibleSuggestions}
                    clueNameById={clueNameById}
                    acceptedRefKeys={state.acceptedRefKeys}
                    isAnalyzing={isAnalyzing}
                    canAnalyze={!isAnalyzing && plan.clues.length > 0}
                    onAnalyze={handleAnalyze}
                    onToggleRef={state.toggleRef}
                />
                <BackfillGrowthSuggestionsCard
                    suggestions={growthSuggestions}
                    acceptedGrowthKeys={state.acceptedGrowthKeys}
                    isAnalyzing={isAnalyzingGrowth}
                    canAnalyze={!isAnalyzingGrowth}
                    onAnalyze={handleAnalyzeGrowth}
                    onToggleGrowth={state.toggleGrowth}
                />
                <BackfillClueRecoveryCard
                    clues={openedClues}
                    selectedIds={state.clueSelection}
                    characters={characters}
                    onToggleClue={state.toggleClue}
                />
            </div>
        </Dialog>
    )
}
