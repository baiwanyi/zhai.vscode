/**
 * 笔记本行尾操作区：悬停时浮出「新建笔记」与「更多」两个图标入口，更多菜单聚合重命名、置顶与删除。
 * 复用 @webview/components/Button 与 @components/ui/dropdown-menu，置顶文案与图标取 getPinToggleMeta。
 * 关键约束：操作区绝对定位贴在行尾且默认 opacity-0 + pointer-events-none，既不占位让计数贴右，也不拦截行点击；
 * 未分类是默认落点，重命名与删除由调用方以 isRenameDeleteDisabled 关掉；菜单名与触发按钮同名，多行并存时可分辨。
 */
import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import type { NotebookSummary } from '@shared/types/notebook'
import { Button } from '@webview/components/Button'
import { getPinToggleMeta } from './constants'
import type { JSX } from 'react'

interface NotebookRowActionsProps {
    notebook: NotebookSummary
    /** 同时关掉重命名与删除：未分类是默认落点，改名或删除都会让它失去指向 */
    isRenameDeleteDisabled: boolean
    onAddNote: () => void
    onRename: () => void
    onTogglePin: () => void
    onDelete: () => void
}

export function NotebookRowActions({
    notebook,
    isRenameDeleteDisabled,
    onAddNote,
    onRename,
    onTogglePin,
    onDelete,
}: NotebookRowActionsProps): JSX.Element {
    const pinToggle = getPinToggleMeta(notebook.isPinned)
    const PinToggleIcon = pinToggle.icon
    const menuLabel = `${notebook.name} 的更多操作`

    return (
        <div className="pointer-events-none absolute right-1 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/notebook:pointer-events-auto group-hover/notebook:opacity-100">
            <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`在 ${notebook.name} 中新建笔记`}
                tooltip="在此笔记本新建笔记"
                onClick={onAddNote}
            >
                <Plus />
            </Button>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-xs" aria-label={menuLabel} tooltip="更多">
                        <MoreHorizontal />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" aria-label={menuLabel}>
                    <DropdownMenuItem disabled={isRenameDeleteDisabled} onSelect={onRename}>
                        <Pencil />
                        重命名
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={onTogglePin}>
                        <PinToggleIcon />
                        {pinToggle.label}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" disabled={isRenameDeleteDisabled} onSelect={onDelete}>
                        <Trash2 />
                        删除
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    )
}
