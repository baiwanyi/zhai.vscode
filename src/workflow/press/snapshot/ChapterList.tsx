/**
 * 章节清单：按卷分组的章节列表，每项展示章名、最近留版时间与版本数，点击进入该章的快照列表。
 * 复用约定：条目取 @components/ui 的 item（outline），图标走 item-media、标题与说明走 item-content、
 * 版本数用 badge 放在 item-actions；分组容器用 item-group，与同目录其它快照列表保持同一套视觉。
 * 关键约束：item-group 自带 role="list"，条目外层必须补 role="listitem"，再在 item 上承担 button 角色与
 * Enter、Space 键处理，否则列表语义与键盘操作都会断；空清单由父级统一呈现引导态，本组件不重复渲染空态。
 */
import { ChevronRightIcon, FileText } from 'lucide-react'
import { useMemo } from 'react'
import { Badge } from '@components/ui/badge'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@components/ui/item'
import type { ChapterSnapshotSummary } from '@shared/types/press'
import { formatSnapshotTime } from './snapshotFormat'
import type { JSX } from 'react'

interface ChapterListProps {
    chapters: ChapterSnapshotSummary[]
    activeChapterPath: string | null
    onSelect: (chapterPath: string) => void
}

export function ChapterList({ chapters, activeChapterPath, onSelect }: ChapterListProps): JSX.Element {
    // 按卷分组：chapters 已按最近留版时间倒序，组内顺序沿用，组间按首次出现顺序
    const groups = useMemo(() => {
        const map = new Map<string, ChapterSnapshotSummary[]>()
        for (const chapter of chapters) {
            const list = map.get(chapter.volume) ?? []
            list.push(chapter)
            map.set(chapter.volume, list)
        }
        return [...map.entries()]
    }, [chapters])

    return (
        <div className="flex flex-col gap-3">
            {groups.map(([volume, items]) => (
                <div key={volume.length > 0 ? volume : '__root'} className="flex flex-col gap-1.5">
                    {volume.length > 0 ? <p className="truncate px-1 text-muted-foreground text-xs">{volume}</p> : null}
                    <ItemGroup>
                        {items.map((item) => {
                            const isActive = item.chapterPath === activeChapterPath
                            return (
                                <div key={item.chapterPath} role="listitem">
                                    <Item
                                        variant={isActive ? 'muted' : 'outline'}
                                        role="button"
                                        tabIndex={0}
                                        aria-current={isActive ? 'true' : undefined}
                                        className="cursor-pointer hover:bg-muted"
                                        onClick={() => onSelect(item.chapterPath)}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault()
                                                onSelect(item.chapterPath)
                                            }
                                        }}
                                    >
                                        <ItemMedia variant="icon">
                                            <FileText />
                                        </ItemMedia>
                                        <ItemContent>
                                            <ItemTitle className="min-w-0">{item.title}</ItemTitle>
                                            <ItemDescription className="text-xs">
                                                最近 {formatSnapshotTime(item.latestAt)}
                                            </ItemDescription>
                                        </ItemContent>
                                        <ItemActions>
                                            <Badge variant="secondary">{item.versionCount} 版</Badge>
                                            <ChevronRightIcon className="size-4" />
                                        </ItemActions>
                                    </Item>
                                </div>
                            )
                        })}
                    </ItemGroup>
                </div>
            ))}
        </div>
    )
}
