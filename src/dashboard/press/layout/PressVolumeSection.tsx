/**
 * 卷区块：卷头行承担折叠切换、「在本卷添加章节」，展开后按批渲染该卷章节。
 * 卷级操作（新建卷/重命名/删除）收在卷头行右键菜单，章节级操作（打开/移动到卷/删除）收在章节行右键菜单，
 * 行内不再放操作按钮，章节行只保留字数信息，左键点击与右键「打开」是同一入口的两条路径。
 * 复用 @components/ui 的 collapsible、context-menu（卷级与章节级操作）、item 条目与 useProgressiveList 的分批渲染。
 * 关键约束：加章按钮位于 CollapsibleTrigger 之外，点击不会连带触发折叠；折叠时不挂滚动观察器，
 * 展开后由 isActive 变化重新建立；未分卷组（历史散章）不提供加章与卷级操作入口，避免继续产生根目录散章，
 * 故卷头行仅在 canAppend 时才挂右键菜单，但其章节仍可移动到正式卷——章节级入口不受卷级开关限制；
 * 右键菜单由 Radix 接管 contextmenu 事件并阻止浏览器默认菜单，右键不触发行的 onClick，
 * 故打开卷菜单不会连带折叠或打开章节；菜单项点击渲染在 portal 中，也不会回落到行上。
 */
import { cn } from 'cn'
import { BookPlus, ChevronRight, FileText, MoveRight, Pencil, Plus, Trash2 } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@components/ui/collapsible'
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuGroup,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuSub,
    ContextMenuSubContent,
    ContextMenuSubTrigger,
    ContextMenuTrigger,
} from '@components/ui/context-menu'
import { Item, ItemActions, ItemContent, ItemTitle } from '@components/ui/item'
import type { PressVolumeGroup } from '@shared/types/press'
import { Button } from '@webview/components/Button'
import { formatWordCount } from '@webview/dashboard/utils'
import type { JSX } from 'react'
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

    // 悬停背景由整行承担；整行同时是右键目标，未分卷组不挂菜单（先构造行本身，再由 canAppend 决定是否包裹）
    const volumeHeader = (
        <div className="flex items-center gap-1 rounded-xl p-1 transition-colors data-[state=open]:bg-muted hover:bg-muted">
            <CollapsibleTrigger asChild>
                {/* 按钮只承担整行的排布与点击：悬停底色由行本身给出，故清掉 ghost 变体的悬停/展开底色与内边距 */}
                <Button
                    variant="ghost"
                    className="h-auto pl-0 min-w-0 flex-1 shrink justify-start gap-1  hover:bg-transparent aria-expanded:bg-transparent dark:hover:bg-transparent"
                >
                    <ChevronRight
                        className={cn(
                            'size-3.5 shrink-0 text-muted-foreground transition-transform',
                            isOpen && 'rotate-90',
                        )}
                    />
                    {/* 标题吃满剩余宽度，把章数顶到右侧，与章节行的字数落在同一列 */}
                    <span className="min-w-0 truncate">{title}</span>
                    <span className="text-xs shrink-0 text-muted-foreground tabular-nums">
                        {volume.chapters.length} 章
                    </span>
                </Button>
            </CollapsibleTrigger>
            {canAppend ? (
                <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 rounded-full hover:bg-transparent"
                    aria-label={`在${title}中添加章节`}
                    tooltip="添加章节"
                    disabled={isCreatingChapter}
                    onClick={() => onCreateChapter(volume.dirName)}
                >
                    <Plus />
                </Button>
            ) : null}
        </div>
    )

    return (
        <Collapsible
            open={isOpen}
            onOpenChange={(open) => onOpenChange(volume.dirName, open)}
            className="flex flex-col gap-1"
        >
            {canAppend ? (
                <ContextMenu>
                    <ContextMenuTrigger asChild>{volumeHeader}</ContextMenuTrigger>
                    <ContextMenuContent>
                        <ContextMenuGroup>
                            <ContextMenuItem disabled={isUpdatingVolume || isCreatingVolume} onSelect={onCreateVolume}>
                                <BookPlus />
                                新建卷
                            </ContextMenuItem>
                            <ContextMenuItem
                                disabled={isUpdatingVolume || isCreatingVolume}
                                onSelect={() => onRenameVolume(volume.dirName)}
                            >
                                <Pencil />
                                重命名
                            </ContextMenuItem>
                        </ContextMenuGroup>
                        <ContextMenuSeparator />
                        <ContextMenuGroup>
                            <ContextMenuItem
                                variant="destructive"
                                disabled={isUpdatingVolume || isCreatingVolume}
                                onSelect={() => onDeleteVolume(volume.dirName)}
                            >
                                <Trash2 />
                                删除
                            </ContextMenuItem>
                        </ContextMenuGroup>
                    </ContextMenuContent>
                </ContextMenu>
            ) : (
                volumeHeader
            )}
            <CollapsibleContent className="flex flex-col gap-0.5 ml-3">
                {visibleChapters.map((chapter) => (
                    <ContextMenu key={chapter.path}>
                        <ContextMenuTrigger asChild>
                            <Item
                                size="xs"
                                className="cursor-pointer rounded-lg px-2 py-1 data-[state=open]:bg-muted hover:bg-muted"
                                aria-label={`打开章节 ${chapter.title}`}
                                onClick={() => onOpenChapter(chapter.path)}
                            >
                                {/* min-w-0 让内容列可收缩；标题必须回到块级布局，flex 容器上 text-overflow 不生效（只会硬切） */}
                                <ItemContent className="min-w-0">
                                    <ItemTitle className="line-clamp-none block w-full truncate">
                                        {chapter.title}
                                    </ItemTitle>
                                </ItemContent>
                                <ItemActions className="shrink-0">
                                    <span className="text-xs text-muted-foreground">
                                        {formatWordCount(chapter.wordCount)} 字
                                    </span>
                                </ItemActions>
                            </Item>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                            <ContextMenuGroup>
                                <ContextMenuItem onSelect={() => onOpenChapter(chapter.path)}>
                                    <FileText />
                                    打开
                                </ContextMenuItem>
                                <ContextMenuSub>
                                    <ContextMenuSubTrigger disabled={isUpdatingChapter || moveTargets.length === 0}>
                                        <MoveRight />
                                        移动到卷
                                    </ContextMenuSubTrigger>
                                    <ContextMenuSubContent>
                                        {moveTargets.map((target) => (
                                            <ContextMenuItem
                                                key={target.dirName}
                                                onSelect={() => onMoveChapter(chapter.path, target.dirName)}
                                            >
                                                {target.name.length > 0 ? target.name : UNSORTED_VOLUME_TITLE}
                                            </ContextMenuItem>
                                        ))}
                                    </ContextMenuSubContent>
                                </ContextMenuSub>
                            </ContextMenuGroup>
                            <ContextMenuSeparator />
                            <ContextMenuGroup>
                                <ContextMenuItem
                                    variant="destructive"
                                    disabled={isUpdatingChapter}
                                    onSelect={() => onDeleteChapter(chapter.path)}
                                >
                                    <Trash2 />
                                    删除
                                </ContextMenuItem>
                            </ContextMenuGroup>
                        </ContextMenuContent>
                    </ContextMenu>
                ))}
                <div ref={sentinelRef} aria-hidden="true" className="h-px w-full" />
                {hasMore ? (
                    <Button variant="ghost" className="rounded-full" onClick={loadMore}>
                        加载更多（剩余 {volume.chapters.length - visibleCount} 章）
                    </Button>
                ) : null}
            </CollapsibleContent>
        </Collapsible>
    )
}
