/**
 * 卷区块：卷头行承担折叠切换、「在本卷添加章节」与卷级操作（新建卷/重命名/删除），展开后按批渲染该卷章节，
 * 章节行另提供移动与删除入口。
 * 复用 @/components/ui 的 collapsible、dropdown-menu、item 条目与 useProgressiveList 的分批渲染。
 * 关键约束：加章与更多操作按钮位于 CollapsibleTrigger 之外，点击不会连带触发折叠；折叠时不挂滚动观察器，
 * 展开后由 isActive 变化重新建立；未分卷组（历史散章）不提供加章与卷级操作入口，避免继续产生根目录散章，
 * 但其章节仍可移动到正式卷——章节级入口不受卷级开关限制；章节菜单的点击须阻断冒泡，避免连带打开章节。
 */
import { cn } from 'cn'
import { BookPlus, ChevronRight, Ellipsis, MoveRight, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Item, ItemActions, ItemContent, ItemTitle } from '@/components/ui/item'
import type { PressVolumeGroup } from '@/shared/types/press'
import type { JSX, MouseEvent } from 'react'
import { formatWordCount } from '../../utils'
import { useProgressiveList } from '../hooks/useProgressiveList'

/** 未分卷组的展示名：历史散章没有卷目录 */
const UNSORTED_VOLUME_TITLE = '未分卷'

/** 章节移动的目标卷：只需目录名与展示名，章节行不关心其下章节清单 */
interface VolumeMoveTarget {
    dirName: string
    name: string
}

interface PressVolumeSectionProps {
    volume: PressVolumeGroup
    isOpen: boolean
    /** 是否允许在本卷新增章节：未分卷组为 false */
    canAppend: boolean
    isCreatingChapter: boolean
    /** 新建卷进行中：与卷级操作共用一个菜单入口的禁用态 */
    isCreatingVolume: boolean
    /** 卷级操作进行中：重命名/删除期间禁用入口，避免并发改动同一目录 */
    isUpdatingVolume: boolean
    /** 章节级操作进行中：移动/删除期间禁用章节入口 */
    isUpdatingChapter: boolean
    /** 章节可移动到的其他卷，由父级按当前卷过滤后传入 */
    moveTargets: VolumeMoveTarget[]
    onOpenChange: (volumeDir: string, isOpen: boolean) => void
    onOpenChapter: (path: string) => void
    onCreateChapter: (volumeDir: string) => void
    onCreateVolume: () => void
    onRenameVolume: (volumeDir: string) => void
    onDeleteVolume: (volumeDir: string) => void
    onMoveChapter: (path: string, targetVolumeDir: string) => void
    onDeleteChapter: (path: string) => void
}

export function PressVolumeSection({
    volume,
    isOpen,
    canAppend,
    isCreatingChapter,
    isCreatingVolume,
    isUpdatingVolume,
    isUpdatingChapter,
    moveTargets,
    onOpenChange,
    onOpenChapter,
    onCreateChapter,
    onCreateVolume,
    onRenameVolume,
    onDeleteVolume,
    onMoveChapter,
    onDeleteChapter,
}: PressVolumeSectionProps): JSX.Element {
    const { visibleCount, hasMore, loadMore, sentinelRef } = useProgressiveList(volume.chapters.length, {
        isActive: isOpen,
    })
    const visibleChapters = volume.chapters.slice(0, visibleCount)
    const title = volume.name.length > 0 ? volume.name : UNSORTED_VOLUME_TITLE

    // 章节行的菜单挂在可点击条目内部，须阻断冒泡，否则点菜单会连带打开章节
    const handleActionClick = (event: MouseEvent): void => {
        event.stopPropagation()
    }

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
                {canAppend ? (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                size="icon-xs"
                                variant="ghost"
                                className="shrink-0 rounded-full"
                                aria-label={`${title}的更多操作`}
                                title="更多操作"
                                disabled={isUpdatingVolume || isCreatingVolume}
                            >
                                <Ellipsis />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuGroup>
                                <DropdownMenuItem onSelect={onCreateVolume}>
                                    <BookPlus />
                                    新建卷
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => onRenameVolume(volume.dirName)}>
                                    <Pencil />
                                    重命名
                                </DropdownMenuItem>
                            </DropdownMenuGroup>
                            <DropdownMenuSeparator />
                            <DropdownMenuGroup>
                                <DropdownMenuItem variant="destructive" onSelect={() => onDeleteVolume(volume.dirName)}>
                                    <Trash2 />
                                    删除
                                </DropdownMenuItem>
                            </DropdownMenuGroup>
                        </DropdownMenuContent>
                    </DropdownMenu>
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
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        size="icon-xs"
                                        variant="ghost"
                                        className="shrink-0 rounded-full"
                                        aria-label={`${chapter.title}的更多操作`}
                                        title="章节操作"
                                        disabled={isUpdatingChapter}
                                        onClick={handleActionClick}
                                    >
                                        <Ellipsis />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuGroup>
                                        <DropdownMenuSub>
                                            <DropdownMenuSubTrigger disabled={moveTargets.length === 0}>
                                                <MoveRight />
                                                移动到卷
                                            </DropdownMenuSubTrigger>
                                            <DropdownMenuSubContent>
                                                {moveTargets.map((target) => (
                                                    <DropdownMenuItem
                                                        key={target.dirName}
                                                        onSelect={() => onMoveChapter(chapter.path, target.dirName)}
                                                    >
                                                        {target.name.length > 0 ? target.name : UNSORTED_VOLUME_TITLE}
                                                    </DropdownMenuItem>
                                                ))}
                                            </DropdownMenuSubContent>
                                        </DropdownMenuSub>
                                    </DropdownMenuGroup>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuGroup>
                                        <DropdownMenuItem
                                            variant="destructive"
                                            onSelect={() => onDeleteChapter(chapter.path)}
                                        >
                                            <Trash2 />
                                            删除
                                        </DropdownMenuItem>
                                    </DropdownMenuGroup>
                                </DropdownMenuContent>
                            </DropdownMenu>
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
