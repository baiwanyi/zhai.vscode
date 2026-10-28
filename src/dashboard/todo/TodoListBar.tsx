/**
 * 待办清单行：左侧是当前清单名，右侧是清单操作下拉。
 * 复用约定：下拉取 @components/ui 的 dropdown-menu（与仪表盘「更多操作」同一套用法），
 * 图标按钮取 @webview/components/Button，图标用 lucide 的 Ellipsis / Plus / Pencil / Trash2 / Check。
 * 关键约束：清单的增删改与切换全部收进下拉——顶部「新建清单」，其后为当前清单的「重命名 / 删除」，
 * 分隔线下列出全部清单供切换（当前项名称后紧跟勾选标记、右侧显示完成进度）；
 * 行内不再放独立按钮，避免同一动作出现两个入口；没有清单时整行不渲染，空态由调用方承接。
 * 文件内的 ActionsMenu / ListItem 为本组件私有实现，仅用于拆开菜单与清单项两段 JSX。
 */
'use client'

import { Check, Ellipsis, Pencil, Plus, Trash2 } from 'lucide-react'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import type { TodoListSummary } from '@shared/types/todo'
import { Button } from '@webview/components/Button'
import type { JSX } from 'react'

/**
 * 删除项的危险色：下拉内容层用 `**:data-[variant=destructive]:text-accent-foreground!`
 * 把 destructive 变体的文字强制拉回常规色，故这里改用显式类；图标另需 important——
 * 菜单项基础样式里有 `not-data-[variant=destructive]:focus:**:text-accent-foreground`，
 * 聚焦（悬停）时会把所有后代文字（含 svg）拉回常规色，不加 important 图标就会在悬停时变色。
 */
const DELETE_ITEM_CLASS = 'text-destructive focus:bg-destructive/10! focus:text-destructive [&_svg]:text-destructive!'

export interface TodoListBarProps {
    lists: TodoListSummary[]
    activeListId: string | null
    isDisabled: boolean
    onSelect: (listId: string) => void
    onCreate: () => void
    onRename: (list: TodoListSummary) => void
    onDelete: (list: TodoListSummary) => void
}

export function TodoListBar({
    lists,
    activeListId,
    isDisabled,
    onSelect,
    onCreate,
    onRename,
    onDelete,
}: TodoListBarProps): JSX.Element | null {
    const activeList = lists.find((list) => list.id === activeListId)
    if (activeList === undefined) {
        return null
    }

    return (
        <div className="flex min-w-0 items-center gap-1">
            <span className="min-w-0 truncate text-xs">{activeList.name}</span>
            <div className="ml-auto flex shrink-0 items-center gap-1">
                <ActionsMenu
                    lists={lists}
                    activeList={activeList}
                    activeListId={activeListId}
                    isDisabled={isDisabled}
                    onSelect={onSelect}
                    onCreate={onCreate}
                    onRename={onRename}
                    onDelete={onDelete}
                />
            </div>
        </div>
    )
}

interface ActionsMenuProps {
    lists: TodoListSummary[]
    activeList: TodoListSummary
    activeListId: string | null
    isDisabled: boolean
    onSelect: (listId: string) => void
    onCreate: () => void
    onRename: (list: TodoListSummary) => void
    onDelete: (list: TodoListSummary) => void
}

/** 清单操作菜单：新建 / 改删当前清单 / 切换清单三段，分隔线一律放在分组之外 */
function ActionsMenu({
    lists,
    activeList,
    activeListId,
    isDisabled,
    onSelect,
    onCreate,
    onRename,
    onDelete,
}: ActionsMenuProps): JSX.Element {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-xs" tooltip="清单操作" aria-label="清单操作" disabled={isDisabled}>
                    <Ellipsis />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuGroup>
                    <DropdownMenuItem disabled={isDisabled} onSelect={onCreate}>
                        <Plus />
                        新建清单
                    </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                    <DropdownMenuItem disabled={isDisabled} onSelect={() => onRename(activeList)}>
                        <Pencil />
                        重命名
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        className={DELETE_ITEM_CLASS}
                        disabled={isDisabled}
                        onSelect={() => onDelete(activeList)}
                    >
                        <Trash2 />
                        删除
                    </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                    {lists.map((list) => (
                        <ListItem
                            key={list.id}
                            list={list}
                            isActive={list.id === activeListId}
                            isDisabled={isDisabled}
                            onSelect={onSelect}
                        />
                    ))}
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

interface ListItemProps {
    list: TodoListSummary
    isActive: boolean
    isDisabled: boolean
    onSelect: (listId: string) => void
}

/** 清单项：名称截断、当前项勾选、右侧完成进度，三者共用同一行菜单 */
function ListItem({ list, isActive, isDisabled, onSelect }: ListItemProps): JSX.Element {
    return (
        <DropdownMenuItem disabled={isDisabled} onSelect={() => onSelect(list.id)}>
            <span className="min-w-0 truncate">{list.name}</span>
            {isActive ? <Check className="size-3.5 shrink-0" /> : null}
            <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                {list.doneCount}/{list.totalCount}
            </span>
        </DropdownMenuItem>
    )
}
