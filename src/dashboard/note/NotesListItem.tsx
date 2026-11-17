/**
 * 笔记条目：呈现标题与相对修改时间，多选态前置复选圈，普通态右键唤出条目操作。
 * 复用 @components/ui 的 item、checkbox 与 context-menu，时间统一走 webview 公共的相对时间格式化。
 * 关键约束：多选态不挂右键菜单，此时行点击只切换勾选，避免与批量操作语义冲突；
 * 复选圈点击须阻止冒泡以免重复切换；置顶项在菜单中呈现「取消置顶」以反映当前状态；
 * 选中态与悬停态一律以背景块表达，不描边（始终走 default 变体，禁止改用 outline 变体）。
 */
import { cn } from 'cn'
import { FolderOpen, Trash2 } from 'lucide-react'
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
import { formatRelativeTime } from '@shared/utils/format'
import { getPinToggleMeta } from './constants'
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
    /** 标题兜底：索引可能落到空标题，空行无法辨认，复选圈也会失去可读名称 */
    const title = note.title.trim() === '' ? '未命名笔记' : note.title
    const pinToggle = getPinToggleMeta(note.isPinned)
    const PinToggleIcon = pinToggle.icon
    /** 行壳类名：多选态与普通态共用，选中与悬停一律以背景块表达 */
    const itemClassName = cn(
        'cursor-pointer rounded-full py-1.5 data-[state=open]:bg-muted hover:bg-muted',
        isActive && 'bg-muted',
    )
    /** 标题与时间：两种形态共用同一份内容，避免多选与普通两套结构各自漂移 */
    const itemBody = (
        <>
            {/* min-w-0 让标题列可收缩，长标题截断后给右侧时间留位 */}
            <ItemContent className="min-w-0">
                {/* ItemTitle 默认是 flex + w-fit：宽度按内容撑开，且 flex 容器下 text-overflow 不生效，
                    长标题只会换行。改为 block + w-full + truncate，宽度受父列约束后才单行省略 */}
                <ItemTitle className={cn('block w-full min-w-0 truncate', isActive && 'font-semibold')}>
                    {title}
                </ItemTitle>
            </ItemContent>
            <ItemActions className="shrink-0">
                <span className="text-xs text-muted-foreground tabular-nums">{formatRelativeTime(note.mtime)}</span>
            </ItemActions>
        </>
    )

    // 多选态只切换勾选，不提供条目级操作：整行是容器，键盘路径由复选圈本身承担
    if (isSelecting) {
        return (
            <Item
                size="sm"
                className={itemClassName}
                aria-current={isActive ? 'true' : undefined}
                onClick={onToggleSelected}
            >
                <Checkbox
                    checked={isSelected}
                    className="rounded-full"
                    aria-label={`选择 ${title}`}
                    onClick={(event) => {
                        event.stopPropagation()
                    }}
                    onCheckedChange={onToggleSelected}
                />
                {itemBody}
            </Item>
        )
    }

    return (
        <ContextMenu>
            {/* 普通态整行是真按钮：Enter/Space 原生可激活，focus-visible 焦点环才落得到行上 */}
            <ContextMenuTrigger asChild>
                <Item asChild size="sm" className={itemClassName} aria-current={isActive ? 'true' : undefined}>
                    <button type="button" className="text-left" onClick={onSelect}>
                        {itemBody}
                    </button>
                </Item>
            </ContextMenuTrigger>
            <ContextMenuContent>
                <ContextMenuGroup>
                    <ContextMenuItem onSelect={() => onInvoke('open')}>
                        <FolderOpen />
                        打开
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => onInvoke(note.isPinned ? 'unpin' : 'pin')}>
                        <PinToggleIcon />
                        {pinToggle.label}
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
