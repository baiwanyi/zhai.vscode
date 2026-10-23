/**
 * 大纲树：左侧的卷-章两级导航，承担章节选择、状态筛选与卷内新增章节。
 * 复用约定：折叠沿用 ui/collapsible，筛选复用 ui/toggle-group，状态点取 PLAN_STATUS_META 的语义底色，
 * 章节行复用与作品章节树一致的圆角与悬停底色；统计口径来自 utils 的 summarizeVolume。
 * 关键约束：章节行只显示「序号 + 标题 + 已写字数」，不展示梗概，避免窄栏里出现多行文本撑高列表；
 * 状态不能只靠圆点表达，行上必须以 aria-label 带上状态文案。
 */
import { cn } from 'cn'
import { ChevronRight, Plus, PlusCircle, ScrollText } from 'lucide-react'
import { Button } from '@components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@components/ui/collapsible'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@components/ui/empty'
import { ToggleGroup, ToggleGroupItem } from '@components/ui/toggle-group'
import type { OutlineVolume, PlanStatus } from '../types'
import type { JSX } from 'react'
import { PLAN_STATUS_META, STATUS_FILTERS } from '../constants'
import { chapterTitleLabel, filterChapters, formatWordCount, summarizeVolume } from '../utils'

interface OutlineTreeProps {
    volumes: OutlineVolume[]
    selectedChapterId: string | null
    expandedVolumeIds: string[]
    statusFilter: PlanStatus | 'all'
    onToggleVolume: (volumeId: string) => void
    onSelectChapter: (chapterId: string) => void
    onFilterChange: (status: PlanStatus | 'all') => void
    onCreateVolume: () => void
    onCreateChapter: (volumeId: string) => void
}

export function OutlineTree({
    volumes,
    selectedChapterId,
    expandedVolumeIds,
    statusFilter,
    onToggleVolume,
    onSelectChapter,
    onFilterChange,
    onCreateVolume,
    onCreateChapter,
}: OutlineTreeProps): JSX.Element {
    const handleFilterChange = (value: string): void => {
        if (value.length === 0) {
            return
        }
        const next = STATUS_FILTERS.find((option) => option.value === value)
        if (next) {
            onFilterChange(next.value)
        }
    }

    return (
        <div className="flex h-full min-h-0 flex-col gap-2">
            <div className="shrink-0 overflow-x-auto">
                <ToggleGroup
                    type="single"
                    size="sm"
                    variant="outline"
                    value={statusFilter}
                    onValueChange={handleFilterChange}
                >
                    {STATUS_FILTERS.map((option) => (
                        <ToggleGroupItem key={option.value} value={option.value}>
                            {option.label}
                        </ToggleGroupItem>
                    ))}
                </ToggleGroup>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
                {volumes.length === 0 ? (
                    <Empty className="border border-dashed border-border py-8">
                        <EmptyHeader>
                            <EmptyMedia variant="icon">
                                <ScrollText />
                            </EmptyMedia>
                            <EmptyTitle>还没有大纲</EmptyTitle>
                            <EmptyDescription>生成一份卷纲，或手动新建第一卷</EmptyDescription>
                        </EmptyHeader>
                        <EmptyContent>
                            <Button size="sm" variant="outline" onClick={onCreateVolume}>
                                <Plus data-icon="inline-start" />
                                新建第一卷
                            </Button>
                        </EmptyContent>
                    </Empty>
                ) : (
                    <div className="flex flex-col gap-1">
                        {volumes.map((volume) => {
                            const summary = summarizeVolume(volume)
                            const isOpen = expandedVolumeIds.includes(volume.id)
                            const visibleChapters = filterChapters(volume.chapters, statusFilter)

                            return (
                                <Collapsible
                                    key={volume.id}
                                    open={isOpen}
                                    onOpenChange={() => onToggleVolume(volume.id)}
                                    className="flex flex-col gap-0.5"
                                >
                                    <div className="flex items-center gap-0.5 rounded-lg px-1 py-1 transition-colors hover:bg-muted">
                                        <CollapsibleTrigger asChild>
                                            <button
                                                type="button"
                                                className="flex min-w-0 flex-1 items-center gap-1 text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                                                aria-expanded={isOpen}
                                            >
                                                <ChevronRight
                                                    className={cn(
                                                        'size-3.5 shrink-0 text-muted-foreground transition-transform',
                                                        isOpen && 'rotate-90',
                                                    )}
                                                    aria-hidden="true"
                                                />
                                                <span className="min-w-0 flex-1 truncate font-medium">
                                                    {volume.name}
                                                </span>
                                                {summary.stale > 0 ? (
                                                    <span
                                                        className="shrink-0 text-destructive tabular-nums"
                                                        title={`${summary.stale} 章需复核`}
                                                    >
                                                        {summary.stale} 待复核
                                                    </span>
                                                ) : null}
                                                <span className="shrink-0 text-muted-foreground tabular-nums">
                                                    {summary.done}/{summary.total}
                                                </span>
                                            </button>
                                        </CollapsibleTrigger>
                                        <Button
                                            size="icon-xs"
                                            variant="ghost"
                                            className="shrink-0 rounded-full"
                                            aria-label={`在${volume.name}中添加章节`}
                                            title="添加章节"
                                            onClick={() => onCreateChapter(volume.id)}
                                        >
                                            <Plus />
                                        </Button>
                                    </div>
                                    <CollapsibleContent className="flex flex-col gap-0.5 pl-3">
                                        {visibleChapters.length === 0 ? (
                                            <p className="px-2 py-1 text-muted-foreground">
                                                {volume.chapters.length === 0 ? '本卷还没有章节' : '没有符合筛选的章节'}
                                            </p>
                                        ) : (
                                            visibleChapters.map((chapter) => {
                                                const meta = PLAN_STATUS_META[chapter.status]
                                                const isSelected = chapter.id === selectedChapterId
                                                return (
                                                    <button
                                                        key={chapter.id}
                                                        type="button"
                                                        aria-current={isSelected ? 'true' : undefined}
                                                        aria-label={`${chapterTitleLabel(chapter)}，${meta.label}`}
                                                        className={cn(
                                                            'flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                                                            isSelected && 'bg-accent text-accent-foreground',
                                                        )}
                                                        onClick={() => onSelectChapter(chapter.id)}
                                                    >
                                                        <span
                                                            className={cn('size-1.5 shrink-0 rounded-full', meta.dot)}
                                                            aria-hidden="true"
                                                        />
                                                        <span className="shrink-0 text-muted-foreground tabular-nums">
                                                            {chapter.order}
                                                        </span>
                                                        <span className="min-w-0 flex-1 truncate">
                                                            {chapterTitleLabel(chapter)}
                                                        </span>
                                                        <span className="shrink-0 text-muted-foreground tabular-nums">
                                                            {chapter.wordCount > 0
                                                                ? formatWordCount(chapter.wordCount)
                                                                : '—'}
                                                        </span>
                                                    </button>
                                                )
                                            })
                                        )}
                                    </CollapsibleContent>
                                </Collapsible>
                            )
                        })}
                        <Button variant="ghost" className="mt-1 rounded-full" onClick={onCreateVolume}>
                            <PlusCircle data-icon="inline-start" />
                            新建卷
                        </Button>
                    </div>
                )}
            </div>
        </div>
    )
}
