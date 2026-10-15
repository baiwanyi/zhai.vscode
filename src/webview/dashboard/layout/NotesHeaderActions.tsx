/**
 * 笔记列表标题行操作：视图密度切换与按模块筛选。
 * 复用 @/components/ui 的 toggle-group 与 dropdown-menu；筛选与密度状态经回调上抛。
 * 关键约束：密度为受控单选值，筛选菜单项须置于 DropdownMenuGroup 内。
 */
import { AlignJustify, Funnel, List } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { ModuleStat, NotesViewMode } from '@/shared/types/dashboard'
import type { JSX } from 'react'

interface NotesHeaderActionsProps {
    viewMode: NotesViewMode
    modules: ModuleStat[]
    activeModules: string[]
    onViewModeChange: (mode: NotesViewMode) => void
    onToggleModule: (name: string) => void
    onResetFilters: () => void
}

export function NotesHeaderActions({
    viewMode,
    modules,
    activeModules,
    onViewModeChange,
    onToggleModule,
    onResetFilters,
}: NotesHeaderActionsProps): JSX.Element {
    const isFiltered = activeModules.length > 0

    return (
        <div className="flex items-center gap-1">
            <ToggleGroup
                type="single"
                size="sm"
                variant="outline"
                value={viewMode}
                aria-label="列表密度"
                onValueChange={(value: string) => {
                    if (value === 'comfortable' || value === 'compact') {
                        onViewModeChange(value)
                    }
                }}
            >
                <ToggleGroupItem value="comfortable" title="舒适模式" aria-label="舒适模式">
                    <List />
                </ToggleGroupItem>
                <ToggleGroupItem value="compact" title="紧凑模式" aria-label="紧凑模式">
                    <AlignJustify />
                </ToggleGroupItem>
            </ToggleGroup>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        size="icon-sm"
                        variant={isFiltered ? 'secondary' : 'ghost'}
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
                                    <span className="ml-auto text-xs text-muted-foreground">{item.fileCount}</span>
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
