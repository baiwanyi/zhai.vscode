/**
 * 生成大纲向导的结果预览：第二步看卷纲结构，第三步逐章勾选要写入的章纲。
 * 复用约定：徽标复用 ui/badge，勾选复用 ui/checkbox，卷卡复用 ui/card 的完整槽位
 * （CardHeader + CardTitle + CardAction + CardContent），章节行的密度与大纲树一致，
 * 保证从预览到工作台不产生视觉跳变。
 * 关键约束：卷级勾选只批量切换本卷章节，不改变卷本身是否写入；被勾选的章节在写入时才会重新编号，
 * 因此这里的顺序只是展示顺序，不能当作最终序号。
 */
import { Badge } from '@components/ui/badge'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@components/ui/card'
import { Checkbox } from '@components/ui/checkbox'
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
                        <Card key={volume.id} size="sm" className="gap-1.5">
                            <CardHeader>
                                <CardTitle className="min-w-0 truncate">{volume.name}</CardTitle>
                                <CardAction className="flex shrink-0 items-center gap-2">
                                    <Badge variant="outline" className="tabular-nums">
                                        {summary.total} 章
                                    </Badge>
                                    <span className="text-muted-foreground tabular-nums">
                                        约 {formatWordCount(summary.wordGoal)} 字
                                    </span>
                                </CardAction>
                            </CardHeader>
                            <CardContent className="flex flex-col gap-1">
                                <CardDescription className="line-clamp-2">阶段目标：{volume.goal}</CardDescription>
                                <CardDescription className="line-clamp-1">核心冲突：{volume.conflict}</CardDescription>
                            </CardContent>
                        </Card>
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
                    <Card key={volume.id} size="sm" className="gap-1">
                        <CardHeader>
                            <CardTitle className="min-w-0 flex-1">
                                <Checkbox
                                    checked={isAllSelected}
                                    aria-label={`全选${volume.name}的章节`}
                                    onCheckedChange={() => onToggleVolume(volume.id)}
                                />
                                <span className="min-w-0 flex-1 truncate">{volume.name}</span>
                            </CardTitle>
                            <CardAction className="text-muted-foreground tabular-nums">
                                {selectedCount}/{volume.chapters.length}
                            </CardAction>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-0.5">
                            {volume.chapters.map((chapter) => {
                                const hookLabel =
                                    HOOK_OPTIONS.find((option) => option.value === chapter.hook)?.label ?? ''
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
                                                <span className="min-w-0 flex-1 truncate font-medium">
                                                    {chapter.title}
                                                </span>
                                                <span className="shrink-0 text-muted-foreground tabular-nums">
                                                    张力 {chapter.tension} · {hookLabel}
                                                </span>
                                            </div>
                                            <p className="line-clamp-2 text-muted-foreground">{chapter.summary}</p>
                                        </div>
                                    </div>
                                )
                            })}
                        </CardContent>
                    </Card>
                )
            })}
        </div>
    )
}
