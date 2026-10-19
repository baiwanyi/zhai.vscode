/**
 * 笔记条目：仅呈现标题，多选态前置复选圈，普通态在悬停或键盘聚焦时露出更多操作。
 * 复用 @components/ui 的 item、checkbox 与 dropdown-menu，以及 webview 公共的相对时间格式化。
 * 关键约束：更多操作按钮默认隐藏，仅在悬停或焦点进入本条目时显现；
 * 复选圈点击须阻止冒泡以免重复切换；置顶项在菜单中呈现「取消置顶」以反映当前状态；
 * 选中态与悬停态一律以背景块表达，不描边（始终走 default 变体，禁止改用 outline 变体）。
 */
import { cn } from 'cn'
import { Ellipsis, Pin, PinOff, Trash2 } from 'lucide-react'
import { Button } from '@components/ui/button'
import { Checkbox } from '@components/ui/checkbox'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { Item, ItemActions, ItemContent, ItemTitle } from '@components/ui/item'
import type { NoteAction, RecentFile } from '@shared/types/dashboard'
import type { JSX } from 'react'

interface NotesListItemProps {
    note: RecentFile
    isActive: boolean
    isSelecting: boolean
    isSelected: boolean
    onSelect: () => void
    onInvoke: (action: NoteAction) => void
    onToggleSelected: () => void
}

export function NotesListItem({
    note,
    isActive,
    isSelecting,
    isSelected,
    onSelect,
    onInvoke,
    onToggleSelected,
}: NotesListItemProps): JSX.Element {
    return (
        <Item
            size="sm"
            className={cn('group/item cursor-pointer rounded-full py-1.5 hover:bg-muted', isActive && 'bg-muted')}
            aria-current={isActive ? 'true' : undefined}
            onClick={isSelecting ? onToggleSelected : onSelect}
        >
            {isSelecting ? (
                <Checkbox
                    checked={isSelected}
                    className="rounded-full"
                    aria-label={`选择 ${note.title}`}
                    onClick={(event) => {
                        event.stopPropagation()
                    }}
                    onCheckedChange={onToggleSelected}
                />
            ) : null}
            <ItemContent>
                <ItemTitle className={cn(isActive && 'font-semibold')}>{note.title}</ItemTitle>
            </ItemContent>
            {isSelecting ? null : (
                <ItemActions className="opacity-0 transition-opacity group-hover/item:opacity-100 focus-within:opacity-100">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                size="icon-xs"
                                variant="ghost"
                                className="rounded-full"
                                title="更多操作"
                                aria-label={`${note.title} 的更多操作`}
                            >
                                <Ellipsis />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuGroup>
                                <DropdownMenuItem onSelect={() => onInvoke('open')}>打开</DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => onInvoke(note.isPinned ? 'unpin' : 'pin')}>
                                    {note.isPinned ? <PinOff /> : <Pin />}
                                    {note.isPinned ? '取消置顶' : '置顶'}
                                </DropdownMenuItem>
                            </DropdownMenuGroup>
                            <DropdownMenuSeparator />
                            <DropdownMenuGroup>
                                <DropdownMenuItem variant="destructive" onSelect={() => onInvoke('delete')}>
                                    <Trash2 />
                                    删除
                                </DropdownMenuItem>
                            </DropdownMenuGroup>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </ItemActions>
            )}
        </Item>
    )
}
