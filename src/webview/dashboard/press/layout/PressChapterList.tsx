/**
 * 章节列表：按卷分组展示章节目录，超过一批数量时随滚动分批追加（默认每批 100 章）。
 * 复用 press/hooks/useProgressiveList 做渲染分批、@/components/ui/item 承载条目与空态组件。
 * 关键约束：分批切片作用在扁平章节序列上，渲染时再按卷重建分组，避免跨批切断卷标题；
 * 未分卷卷组不显示分组标题，避免出现无意义的空档。
 */
import { ChevronRight, FileText } from 'lucide-react'
import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Item, ItemActions, ItemContent, ItemTitle } from '@/components/ui/item'
import type { PressChapterEntry, PressVolumeGroup } from '@/shared/types/press'
import type { JSX } from 'react'
import { formatWordCount } from '../../utils'
import { useProgressiveList } from '../hooks/useProgressiveList'

/** 扁平序列中的一章：携带所属卷信息，供切片后重建分组 */
interface FlatChapter {
    volumeDir: string
    volumeName: string
    chapter: PressChapterEntry
}

/** 重建后的可见分组：key 用卷目录名（未分卷为空串），同一卷相邻条目合并 */
interface VisibleGroup {
    key: string
    title: string
    chapters: PressChapterEntry[]
}

function flattenVolumes(volumes: PressVolumeGroup[]): FlatChapter[] {
    return volumes.flatMap((volume) =>
        volume.chapters.map((chapter) => ({
            volumeDir: volume.dirName,
            volumeName: volume.name,
            chapter,
        })),
    )
}

function groupChapters(items: FlatChapter[]): VisibleGroup[] {
    const groups: VisibleGroup[] = []
    for (const item of items) {
        const last = groups[groups.length - 1]
        if (last !== undefined && last.key === item.volumeDir) {
            last.chapters.push(item.chapter)
            continue
        }
        groups.push({ key: item.volumeDir, title: item.volumeName, chapters: [item.chapter] })
    }
    return groups
}

interface PressChapterListProps {
    volumes: PressVolumeGroup[]
    onOpenChapter: (path: string) => void
}

export function PressChapterList({ volumes, onOpenChapter }: PressChapterListProps): JSX.Element {
    const flat = useMemo(() => flattenVolumes(volumes), [volumes])
    const { visibleCount, hasMore, loadMore, sentinelRef } = useProgressiveList(flat.length)
    const groups = useMemo(() => groupChapters(flat.slice(0, visibleCount)), [flat, visibleCount])

    if (flat.length === 0) {
        return (
            <Empty>
                <EmptyHeader>
                    <EmptyMedia variant="icon">
                        <FileText />
                    </EmptyMedia>
                    <EmptyTitle>还没有章节</EmptyTitle>
                    <EmptyDescription>
                        点击「添加章节」生成第一章，或在 Chapter/ 下新建文档后保存，列表会自动更新。
                    </EmptyDescription>
                </EmptyHeader>
            </Empty>
        )
    }

    return (
        <div className="flex flex-col gap-3">
            {groups.map((group) => (
                <section key={group.key} className="flex flex-col gap-1">
                    {group.title.length > 0 ? (
                        <h3 className="px-1 text-xs font-medium text-muted-foreground">{group.title}</h3>
                    ) : null}
                    <div className="flex flex-col">
                        {group.chapters.map((chapter) => (
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
                    </div>
                </section>
            ))}
            <div ref={sentinelRef} aria-hidden="true" className="h-px w-full" />
            {hasMore ? (
                <Button variant="ghost" size="sm" className="rounded-full" onClick={loadMore}>
                    加载更多（剩余 {flat.length - visibleCount} 章）
                </Button>
            ) : null}
        </div>
    )
}
