/**
 * 笔记列表标题行操作：非多选态提供按模块筛选与进入多选，多选态只提供退出。
 * 复用 @components/ui 的 dropdown-menu 与 button；独立图标按钮复用 button 的 icon-sm 尺寸并用 ui/tooltip 说明，
 * 作为菜单触发器的按钮保留原生 title（不与 Radix Trigger 嵌套，避免浮层与菜单状态互相干扰）。
 * 状态经回调上抛，组件自身不持有。
 * 关键约束：筛选菜单项须置于 DropdownMenuGroup 内；多选态隐藏筛选，避免两个模式的操作相互干扰。
 */
import { Funnel, ListChecks, X } from 'lucide-react'
import { Button } from '@components/ui/button'
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@components/ui/tooltip'
import type { ModuleStat } from '@shared/types/dashboard'
import type { JSX } from 'react'

interface NotesHeaderActionsProps {
    modules: ModuleStat[]
    activeModules: string[]
    isSelecting: boolean
    onToggleModule: (name: string) => void
    onResetFilters: () => void
    onToggleSelecting: () => void
}

export function NotesHeaderActions({
    modules,
    activeModules,
    isSelecting,
    onToggleModule,
    onResetFilters,
    onToggleSelecting,
}: NotesHeaderActionsProps): JSX.Element {
    if (isSelecting) {
        return (
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant="secondary"
                        size="icon"
                        className="rounded-full"
                        aria-label="退出多选"
                        onClick={onToggleSelecting}
                    >
                        <X />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>退出多选</TooltipContent>
            </Tooltip>
        )
    }

    const isFiltered = activeModules.length > 0

    return (
        <div className="flex items-center gap-1">
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="rounded-full"
                        aria-label="多选"
                        onClick={onToggleSelecting}
                    >
                        <ListChecks />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>多选</TooltipContent>
            </Tooltip>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant={isFiltered ? 'secondary' : 'ghost'}
                        size="icon"
                        className="rounded-full"
                        title="筛选笔记"
                        aria-label="筛选笔记"
                    >
                        <Funnel />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuLabel>按模块筛选</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {modules.length === 0 ? (
                        <DropdownMenuItem disabled>暂无可筛选模块</DropdownMenuItem>
                    ) : (
                        <DropdownMenuGroup>
                            {modules.map((item) => (
                                <DropdownMenuCheckboxItem
                                    key={item.name}
                                    checked={activeModules.includes(item.name)}
                                    onCheckedChange={() => onToggleModule(item.name)}
                                >
                                    {item.name}
                                    <span className="ml-auto text-muted-foreground">{item.fileCount}</span>
                                </DropdownMenuCheckboxItem>
                            ))}
                        </DropdownMenuGroup>
                    )}
                    {isFiltered ? (
                        <>
                            <DropdownMenuSeparator />
                            <DropdownMenuGroup>
                                <DropdownMenuItem onSelect={onResetFilters}>清除筛选</DropdownMenuItem>
                            </DropdownMenuGroup>
                        </>
                    ) : null}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    )
}
