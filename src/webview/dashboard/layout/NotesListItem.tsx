/**
 * 笔记条目：呈现标题与相对修改时间，多选态前置复选圈，普通态右键唤出条目操作。
 * 复用 @components/ui 的 item、checkbox 与 context-menu，时间统一走 webview 公共的相对时间格式化。
 * 关键约束：多选态不挂右键菜单，此时行点击只切换勾选，避免与批量操作语义冲突；
 * 复选圈点击须阻止冒泡以免重复切换；置顶项在菜单中呈现「取消置顶」以反映当前状态；
 * 选中态与悬停态一律以背景块表达，不描边（始终走 default 变体，禁止改用 outline 变体）。
 */
import { cn } from 'cn'
import { FolderOpen, Pin, PinOff, Trash2 } from 'lucide-react'
import { Checkbox } from '@components/ui/checkbox'
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuGroup,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from '@components/ui/context-menu'
import { Item, ItemActions, ItemContent, ItemTitle } from '@components/ui/item'
import type { NoteAction, RecentFile } from '@shared/types/dashboard'
import type { JSX } from 'react'
import { formatRelativeTime } from '../../utils'

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
    const item = (
        <Item
            size="sm"
            className={cn(
                'cursor-pointer rounded-full py-1.5 data-[state=open]:bg-muted hover:bg-muted',
                isActive && 'bg-muted',
            )}
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
            {/* min-w-0 让标题列可收缩，长标题截断后给右侧时间留位 */}
            <ItemContent className="min-w-0">
                <ItemTitle className={cn(isActive && 'font-semibold')}>{note.title}</ItemTitle>
            </ItemContent>
            <ItemActions className="shrink-0">
                <span className="text-xs text-muted-foreground tabular-nums">{formatRelativeTime(note.mtime)}</span>
            </ItemActions>
        </Item>
    )

    // 多选态只切换勾选，不提供条目级操作，避免与批量删除等语义冲突
    if (isSelecting) {
        return item
    }

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>{item}</ContextMenuTrigger>
            <ContextMenuContent>
                <ContextMenuGroup>
                    <ContextMenuItem onSelect={() => onInvoke('open')}>
                        <FolderOpen />
                        打开
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => onInvoke(note.isPinned ? 'unpin' : 'pin')}>
                        {note.isPinned ? <PinOff /> : <Pin />}
                        {note.isPinned ? '取消置顶' : '置顶'}
                    </ContextMenuItem>
                </ContextMenuGroup>
                <ContextMenuSeparator />
                <ContextMenuGroup>
                    <ContextMenuItem variant="destructive" onSelect={() => onInvoke('delete')}>
                        <Trash2 />
                        删除
                    </ContextMenuItem>
                </ContextMenuGroup>
            </ContextMenuContent>
        </ContextMenu>
    )
}
