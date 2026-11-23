/**
 * 写后回填：把章节文档的实际摘要与字数同步回章纲，并把已回收的伏笔标记完成。
 * 复用约定：事实由 press/outline/facts 读取（useChapterFacts），卷章匹配按「卷序 + 卷内位置」；
 * 弹层复用 ui/dialog，勾选行沿用 components/Button 的 ghost 变体与 CheckSquare / Square 图标；
 * 确认后一次性回传整批卷章与线索，由页面立即写盘。
 * 关键约束：只改大纲、不改章节正文；未勾选的章与线索一律不动；
 * 「计划梗概」永远不被覆盖——事实写进 actualSummary，两者的差异在行内并排展示。
 */
import { CheckSquare, RefreshCw, Square } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge } from '@components/ui/badge'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@components/ui/dialog'
import { Button } from '@webview/components/Button'
import type { CharacterCard, OutlineChapter, OutlineClue, OutlinePlan, OutlineVolume, PlanStatus } from '../../types'
import type { JSX } from 'react'
import { CLUE_STATUS_META } from '../../constants'
import { chapterTitleLabel, createChapterRefEntries, formatWordCount } from '../../utils'
import { useChapterFacts } from '../hooks/useChapterFacts'

/** 一行回填差异：章纲计划与章节事实并排放，供作者逐项确认 */
interface BackfillRow {
    chapter: OutlineChapter
    volumeName: string
    factSummary: string
    factWordCount: number
    factStatus: string
    hasSummaryChange: boolean
    hasWordCountChange: boolean
}

/** 章节状态到章纲状态：已发布或有正文即「已写」，修订中映射「待改」 */
function toPlanStatus(factStatus: string, wordCount: number): PlanStatus {
    if (factStatus === 'revising') {
        return 'revise'
    }
    return factStatus === 'published' || wordCount > 0 ? 'written' : 'planned'
}

/** 线索的一句话描述：埋设章 → 回收章 */
function clueLabel(clue: OutlineClue): string {
    const plant = clue.plant === null ? '未定' : `${String(clue.plant.volumeOrder)}-${String(clue.plant.chapterOrder)}`
    const payoff =
        clue.payoff === null ? '未定' : `${String(clue.payoff.volumeOrder)}-${String(clue.payoff.chapterOrder)}`
    return `埋设 ${plant} → 回收 ${payoff}`
}

interface OutlineBackfillDialogProps {
    isOpen: boolean
    onOpenChange: (isOpen: boolean) => void
    dirPath: string
    volumes: OutlineVolume[]
    plan: OutlinePlan
    characters: CharacterCard[]
    onApply: (next: { volumes: OutlineVolume[]; plan: OutlinePlan }) => void
}

export function OutlineBackfillDialog({
    isOpen,
    onOpenChange,
    dirPath,
    volumes,
    plan,
    characters,
    onApply,
}: OutlineBackfillDialogProps): JSX.Element {
    const { isLoading, facts, reload } = useChapterFacts(dirPath, isOpen)
    // 选中项用 null 表示「默认全选」：事实刷新后自动跟随，用户主动取消后才落成明确数组
    const [selection, setSelection] = useState<string[] | null>(null)
    const [clueSelection, setClueSelection] = useState<string[]>([])

    const rows = useMemo<BackfillRow[]>(() => {
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
                    factStatus: fact.status,
                    hasSummaryChange,
                    hasWordCountChange,
                },
            ]
        })
    }, [facts, volumes])

    const selectedChapterIds = selection ?? rows.map((row) => row.chapter.id)
    const openedClues = plan.clues.filter((clue) => clue.status === 'planted')

    const handleToggleChapter = (chapterId: string): void => {
        setSelection(
            selectedChapterIds.includes(chapterId)
                ? selectedChapterIds.filter((id) => id !== chapterId)
                : [...selectedChapterIds, chapterId],
        )
    }

    const handleToggleClue = (clueId: string): void => {
        setClueSelection((previous) =>
            previous.includes(clueId) ? previous.filter((id) => id !== clueId) : [...previous, clueId],
        )
    }

    const handleApply = (): void => {
        const nextVolumes: OutlineVolume[] = volumes.map((volume) => ({
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
                    status: toPlanStatus(row.factStatus, row.factWordCount),
                }
            }),
        }))
        const nextPlan: OutlinePlan = {
            ...plan,
            clues: plan.clues.map((clue) => (clueSelection.includes(clue.id) ? { ...clue, status: 'paid-off' } : clue)),
        }
        onApply({ volumes: nextVolumes, plan: nextPlan })
        onOpenChange(false)
        setSelection(null)
        setClueSelection([])
    }

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[calc(100vh-4rem)] flex-col gap-3 sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle className="text-lg">写后回填</DialogTitle>
                    <DialogDescription>
                        正文偏离大纲很正常：把章节里的实际摘要与字数回填到章纲，并勾选本章已回收的伏笔
                    </DialogDescription>
                </DialogHeader>

                <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-0.5">
                    {isLoading ? (
                        <p className="text-muted-foreground">正在读取章节事实...</p>
                    ) : rows.length === 0 ? (
                        <p className="text-muted-foreground">正文与大纲目前一致，没有需要回填的差异。</p>
                    ) : (
                        <div className="flex flex-col gap-1.5">
                            <div className="flex items-center justify-between">
                                <span className="text-muted-foreground">章纲差异（{rows.length} 章）</span>
                                <Button variant="ghost" onClick={reload}>
                                    <RefreshCw />
                                    重新读取
                                </Button>
                            </div>
                            {rows.map((row) => {
                                const isSelected = selectedChapterIds.includes(row.chapter.id)
                                return (
                                    <div
                                        key={row.chapter.id}
                                        className="flex flex-col gap-1 rounded-lg border border-border px-2 py-1.5"
                                    >
                                        <div className="flex items-center gap-1.5">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="shrink-0 rounded-full"
                                                aria-label={isSelected ? '取消回填该章' : '回填该章'}
                                                aria-pressed={isSelected}
                                                onClick={() => handleToggleChapter(row.chapter.id)}
                                            >
                                                {isSelected ? (
                                                    <CheckSquare className="text-chart-2" aria-hidden="true" />
                                                ) : (
                                                    <Square aria-hidden="true" />
                                                )}
                                            </Button>
                                            <span className="min-w-0 flex-1 truncate font-medium">
                                                {chapterTitleLabel(row.chapter)}
                                            </span>
                                            <Badge variant="outline">{row.volumeName}</Badge>
                                            {row.hasWordCountChange ? (
                                                <span className="shrink-0 text-muted-foreground tabular-nums">
                                                    {formatWordCount(row.chapter.wordCount)} →{' '}
                                                    {formatWordCount(row.factWordCount)}
                                                </span>
                                            ) : null}
                                        </div>
                                        <div className="flex flex-col gap-0.5 pl-9">
                                            <span className="text-muted-foreground">
                                                计划：{row.chapter.summary || '未填'}
                                            </span>
                                            {row.hasSummaryChange ? (
                                                <span>实际：{row.factSummary}</span>
                                            ) : (
                                                <span className="text-muted-foreground">实际摘要无变化</span>
                                            )}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}

                    {openedClues.length === 0 ? null : (
                        <div className="flex flex-col gap-1.5">
                            <span className="text-muted-foreground">
                                标记已回收的伏笔（{openedClues.length} 条未回收）
                            </span>
                            {openedClues.map((clue) => {
                                const isSelected = clueSelection.includes(clue.id)
                                const trigger = characters.find((character) => character.id === clue.triggerId)
                                return (
                                    <div
                                        key={clue.id}
                                        className="flex items-center gap-1.5 rounded-lg border border-border px-2 py-1"
                                    >
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="shrink-0 rounded-full"
                                            aria-label={
                                                isSelected ? `取消回收「${clue.name}」` : `标记「${clue.name}」已回收`
                                            }
                                            aria-pressed={isSelected}
                                            onClick={() => handleToggleClue(clue.id)}
                                        >
                                            {isSelected ? (
                                                <CheckSquare className="text-chart-2" aria-hidden="true" />
                                            ) : (
                                                <Square aria-hidden="true" />
                                            )}
                                        </Button>
                                        <span className="min-w-0 flex-1 truncate">{clue.name}</span>
                                        <span className="shrink-0 text-muted-foreground">{clueLabel(clue)}</span>
                                        <Badge variant="outline">
                                            {trigger === undefined ? '未指定触发者' : trigger.name}
                                        </Badge>
                                        <Badge variant="outline">{CLUE_STATUS_META[clue.status].label}</Badge>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>

                <DialogFooter className="items-center gap-2">
                    <span className="flex-1 text-muted-foreground">回填只覆盖章纲与线索表，不会修改章节正文</span>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>
                        取消
                    </Button>
                    <Button disabled={rows.length === 0 && clueSelection.length === 0} onClick={handleApply}>
                        回填所选
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
