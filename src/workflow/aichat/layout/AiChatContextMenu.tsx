/**
 * 「添加上下文」一级菜单：扁平四项 + 规则子菜单，只负责选定视图与挂载规则，不承载搜索与列表。
 * 复用约定：外壳取 @components/ui 的 DropdownMenu，触发器取 @webview/components/Button；
 * 规则子菜单取共享层 RuleMenu，与出图侧同一份实现；视图联合类型与查询目标取 ../constants。
 * 关键约束：选择作品进入来源列表后再选作品，其余三项直接进入候选列表；
 * 规则子菜单的编辑与删除弹窗必须渲染在菜单之外（菜单收起会卸载子树），由工具行负责挂载。
 */
import { Command, FileText, Library, Newspaper, Package } from 'lucide-react'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import type { PromptRule } from '@shared/types/imagegen'
import { Button } from '@webview/components/Button'
import { RuleMenu } from '@webview/components/RuleMenu'
import type { AiContextPickerView } from '../constants'
import type { JSX } from 'react'

interface AiChatContextMenuProps {
    disabled: boolean
    /** 选定视图：由页面打开面板并渲染对应列表 */
    onSelect: (view: AiContextPickerView) => void
    /** 已列举的规则：排序与归属由工具行的 useRuleMenu 决定 */
    rules: readonly PromptRule[]
    isLoadingRules: boolean
    /** 已挂规则名：子菜单据此回显挂载态 */
    selectedRules: readonly string[]
    onToggleRule: (rule: PromptRule) => void
    onEditRule: (rule: PromptRule) => void
    onDeleteRule: (rule: PromptRule) => void
    onCreateRule: () => void
    onOpenRuleDir: () => void
    /** 菜单受控开合：规则编辑与删除需要先收起菜单，再由工具行打开对应弹窗 */
    open: boolean
    onOpenChange: (isOpen: boolean) => void
}

export function AiChatContextMenu({
    disabled,
    onSelect,
    rules,
    isLoadingRules,
    selectedRules,
    onToggleRule,
    onEditRule,
    onDeleteRule,
    onCreateRule,
    onOpenRuleDir,
    open,
    onOpenChange,
}: AiChatContextMenuProps): JSX.Element {
    return (
        <DropdownMenu open={open} onOpenChange={onOpenChange}>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="rounded-full text-muted-foreground"
                    tooltip="添加上下文"
                    aria-label="添加上下文"
                    disabled={disabled}
                >
                    <Command />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
                <DropdownMenuLabel>添加上下文</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onSelect({ mode: 'source', scope: 'notebook' })} className="gap-2">
                    <Library className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">选择笔记本</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                    onSelect={() => onSelect({ mode: 'items', target: { kind: 'note' } })}
                    className="gap-2"
                >
                    <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">选择笔记</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                    onSelect={() => onSelect({ mode: 'items', target: { kind: 'article' } })}
                    className="gap-2"
                >
                    <Newspaper className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">选择文章</span>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onSelect({ mode: 'source', scope: 'project' })} className="gap-2">
                    <Package className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">选择作品</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <RuleMenu
                    rules={rules}
                    isLoading={isLoadingRules}
                    selectedRules={selectedRules}
                    onToggle={onToggleRule}
                    onEdit={onEditRule}
                    onDelete={onDeleteRule}
                    onCreate={onCreateRule}
                    onOpenDir={onOpenRuleDir}
                />
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
