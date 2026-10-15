/**
 * 笔记条目：标题与修改时间，选中态以描边凸显，紧凑密度下省略时间行。
 * 复用 @/components/ui 的 item 与 dropdown-menu、webview 公共的相对时间格式化。
 * 关键约束：更多操作按钮须阻止冒泡，避免展开菜单时连带触发条目选中。
 */
import { cn } from 'cn'
import { Ellipsis, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item'
import type { NoteAction, RecentFile } from '@/shared/types/dashboard'
import type { JSX } from 'react'
import { formatRelativeTime } from '../../utils'

interface NotesListItemProps {
    note: RecentFile
    isActive: boolean
    isCompact: boolean
    onSelect: () => void
    onInvoke: (action: NoteAction) => void
}

export function NotesListItem({ note, isActive, isCompact, onSelect, onInvoke }: NotesListItemProps): JSX.Element {
    const time = formatRelativeTime(note.mtime)
    const hasTime = !isCompact && time !== ''

    return (
        <Item
            variant={isActive ? 'outline' : 'default'}
            size={isCompact ? 'xs' : 'sm'}
            className={cn('cursor-pointer hover:bg-muted', isCompact ? 'rounded-md' : 'rounded-full')}
            aria-current={isActive ? 'true' : undefined}
            onClick={onSelect}
        >
            <ItemContent>
                <ItemTitle className={cn(isActive && 'font-semibold')}>{note.title}</ItemTitle>
                {hasTime ? <ItemDescription>{time}</ItemDescription> : null}
            </ItemContent>
            <ItemActions>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            size="icon-xs"
                            variant="ghost"
                            className="rounded-full"
                            title="更多操作"
                            aria-label={`${note.title} 的更多操作`}
                            onClick={(event) => {
                                event.stopPropagation()
                            }}
                        >
                            <Ellipsis />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuGroup>
                            <DropdownMenuItem onSelect={() => onInvoke('open')}>打开</DropdownMenuItem>
                            <DropdownMenuItem variant="destructive" onSelect={() => onInvoke('delete')}>
                                <Trash2 />
                                删除
                            </DropdownMenuItem>
                        </DropdownMenuGroup>
                    </DropdownMenuContent>
                </DropdownMenu>
            </ItemActions>
        </Item>
    )
}
