/**
 * 生成大纲向导的结果预览：第二步看卷纲结构，第三步逐章勾选要写入的章纲。
 * 复用约定：徽标复用 ui/badge，勾选复用 ui/checkbox，卷卡沿用设定页的 border + card 圆角与内边距，
 * 章节行的密度与大纲树一致，保证从预览到工作台不产生视觉跳变。
 * 关键约束：卷级勾选只批量切换本卷章节，不改变卷本身是否写入；被勾选的章节在写入时才会重新编号，
 * 因此这里的顺序只是展示顺序，不能当作最终序号。
 */
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import type { OutlineVolume } from '../types'
import type { JSX } from 'react'
import { HOOK_OPTIONS } from '../constants'
import { formatWordCount, summarizeVolume } from '../utils'

interface OutlineWizardPlanProps {
    step: 'volume' | 'chapter'
    draft: OutlineVolume[]
    selectedChapterIds: ReadonlySet<string>
    onToggleChapter: (chapterId: string) => void
    onToggleVolume: (volumeId: string) => void
}

export function OutlineWizardPlan({
    step,
    draft,
    selectedChapterIds,
    onToggleChapter,
    onToggleVolume,
}: OutlineWizardPlanProps): JSX.Element {
    if (step === 'volume') {
        return (
            <div className="flex flex-col gap-2">
                {draft.map((volume) => {
                    const summary = summarizeVolume(volume)
                    return (
                        <div key={volume.id} className="flex flex-col gap-1 rounded-xl border border-border bg-card p-2.5">
                            <div className="flex items-center gap-2">
                                <span className="min-w-0 flex-1 truncate text-xs font-medium">{volume.name}</span>
                                <Badge variant="outline" className="shrink-0 tabular-nums">
                                    {summary.total} 章
                                </Badge>
                                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                                    约 {formatWordCount(summary.wordGoal)} 字
                                </span>
                            </div>
                            <p className="line-clamp-2 text-xs text-muted-foreground">阶段目标：{volume.goal}</p>
                            <p className="line-clamp-1 text-xs text-muted-foreground">核心冲突：{volume.conflict}</p>
                        </div>
                    )
                })}
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-2">
            {draft.map((volume) => {
                const selectedCount = volume.chapters.filter((chapter) => selectedChapterIds.has(chapter.id)).length
                const isAllSelected = volume.chapters.length > 0 && selectedCount === volume.chapters.length

                return (
                    <div key={volume.id} className="flex flex-col gap-1 rounded-xl border border-border bg-card p-2">
                        <div className="flex items-center gap-2 px-1">
                            <Checkbox
                                checked={isAllSelected}
                                aria-label={`全选${volume.name}的章节`}
                                onCheckedChange={() => onToggleVolume(volume.id)}
                            />
                            <span className="min-w-0 flex-1 truncate text-xs font-medium">{volume.name}</span>
                            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                                {selectedCount}/{volume.chapters.length}
                            </span>
                        </div>
                        <div className="flex flex-col gap-0.5">
                            {volume.chapters.map((chapter) => {
                                const hookLabel = HOOK_OPTIONS.find((option) => option.value === chapter.hook)?.label ?? ''
                                return (
                                    <div
                                        key={chapter.id}
                                        className="flex items-start gap-2 rounded-lg px-1 py-1 hover:bg-muted/50"
                                    >
                                        <Checkbox
                                            checked={selectedChapterIds.has(chapter.id)}
                                            className="mt-0.5"
                                            aria-label={`选择${chapter.title}`}
                                            onCheckedChange={() => onToggleChapter(chapter.id)}
                                        />
                                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                            <div className="flex items-center gap-1.5">
                                                <span className="min-w-0 flex-1 truncate text-xs font-medium">
                                                    {chapter.title}
                                                </span>
                                                <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                                                    张力 {chapter.tension} · {hookLabel}
                                                </span>
                                            </div>
                                            <p className="line-clamp-2 text-xs text-muted-foreground">{chapter.summary}</p>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                )
            })}
        </div>
    )
}
