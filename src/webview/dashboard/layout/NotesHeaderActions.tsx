/**
 * 笔记列表标题行操作：非多选态提供按模块筛选与进入多选，多选态只提供退出。
 * 复用 @components/ui 的 dropdown-menu 与 @webview/components/Button；独立图标按钮用 icon 尺寸，提示经 tooltip 参数给出，
 * 作为菜单触发器的按钮保留原生 title（不与 Radix Trigger 嵌套，避免浮层与菜单状态互相干扰）。
 * 状态经回调上抛，组件自身不持有。
 * 关键约束：筛选菜单项须置于 DropdownMenuGroup 内；多选态隐藏筛选，避免两个模式的操作相互干扰。
 */
import { Funnel, ListChecks, X } from 'lucide-react'
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
import type { ModuleStat } from '@shared/types/dashboard'
import { Button } from '@webview/components/Button'
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
            <Button
                variant="secondary"
                size="icon"
                className="rounded-full"
                aria-label="退出多选"
                tooltip="退出多选"
                onClick={onToggleSelecting}
            >
                <X />
            </Button>
        )
    }

    const isFiltered = activeModules.length > 0

    return (
        <div className="flex items-center gap-1">
            <Button
                variant="ghost"
                size="icon"
                className="rounded-full"
                aria-label="多选"
                tooltip="多选"
                onClick={onToggleSelecting}
            >
                <ListChecks />
            </Button>
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
