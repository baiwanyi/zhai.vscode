/**
 * 卷区块：卷头行承担折叠切换与「在本卷添加章节」，展开后按批渲染该卷章节。
 * 复用 @/components/ui/collapsible 的折叠语义、item 条目与 useProgressiveList 的分批渲染。
 * 关键约束：加章按钮位于 CollapsibleTrigger 之外，点击不会连带触发折叠；折叠时不挂滚动观察器，
 * 展开后由 isActive 变化重新建立；未分卷组（历史散章）不提供加章入口，避免继续产生根目录散章。
 */
import { cn } from 'cn'
import { ChevronRight, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Item, ItemActions, ItemContent, ItemTitle } from '@/components/ui/item'
import type { PressVolumeGroup } from '@/shared/types/press'
import type { JSX } from 'react'
import { formatWordCount } from '../../utils'
import { useProgressiveList } from '../hooks/useProgressiveList'

/** 未分卷组的展示名：历史散章没有卷目录 */
const UNSORTED_VOLUME_TITLE = '未分卷'

interface PressVolumeSectionProps {
    volume: PressVolumeGroup
    isOpen: boolean
    /** 是否允许在本卷新增章节：未分卷组为 false */
    canAppend: boolean
    isCreatingChapter: boolean
    onOpenChange: (volumeDir: string, isOpen: boolean) => void
    onOpenChapter: (path: string) => void
    onCreateChapter: (volumeDir: string) => void
}

export function PressVolumeSection({
    volume,
    isOpen,
    canAppend,
    isCreatingChapter,
    onOpenChange,
    onOpenChapter,
    onCreateChapter,
}: PressVolumeSectionProps): JSX.Element {
    const { visibleCount, hasMore, loadMore, sentinelRef } = useProgressiveList(volume.chapters.length, {
        isActive: isOpen,
    })
    const visibleChapters = volume.chapters.slice(0, visibleCount)
    const title = volume.name.length > 0 ? volume.name : UNSORTED_VOLUME_TITLE

    return (
        <Collapsible
            open={isOpen}
            onOpenChange={(open) => onOpenChange(volume.dirName, open)}
            className="flex flex-col gap-1"
        >
            <div className="flex items-center gap-1">
                <CollapsibleTrigger asChild>
                    <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-0.5 text-left hover:bg-muted"
                    >
                        <ChevronRight
                            className={cn(
                                'size-3.5 shrink-0 text-muted-foreground transition-transform',
                                isOpen && 'rotate-90',
                            )}
                        />
                        <span className="truncate text-xs font-medium">{title}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">{volume.chapters.length} 章</span>
                    </button>
                </CollapsibleTrigger>
                {canAppend ? (
                    <Button
                        size="icon-xs"
                        variant="ghost"
                        className="shrink-0 rounded-full"
                        aria-label={`在${title}中添加章节`}
                        title="添加章节"
                        disabled={isCreatingChapter}
                        onClick={() => onCreateChapter(volume.dirName)}
                    >
                        <Plus />
                    </Button>
                ) : null}
            </div>
            <CollapsibleContent className="flex flex-col gap-0.5">
                {visibleChapters.map((chapter) => (
                    <Item
                        key={chapter.path}
                        size="xs"
                        className="cursor-pointer rounded-lg px-2 py-1 hover:bg-muted"
                        aria-label={`打开章节 ${chapter.title}`}
                        onClick={() => onOpenChapter(chapter.path)}
                    >
                        <ItemContent>
                            <ItemTitle className="w-full truncate text-xs">{chapter.title}</ItemTitle>
                        </ItemContent>
                        <ItemActions>
                            <span className="text-[11px] text-muted-foreground">
                                {formatWordCount(chapter.wordCount)} 字
                            </span>
                            <ChevronRight className="size-3.5 text-muted-foreground" />
                        </ItemActions>
                    </Item>
                ))}
                <div ref={sentinelRef} aria-hidden="true" className="h-px w-full" />
                {hasMore ? (
                    <Button variant="ghost" size="sm" className="rounded-full" onClick={loadMore}>
                        加载更多（剩余 {volume.chapters.length - visibleCount} 章）
                    </Button>
                ) : null}
            </CollapsibleContent>
        </Collapsible>
    )
}
