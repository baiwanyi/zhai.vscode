/**
 * 生图「规则」子菜单：子菜单列出规则 md，行内完成挂载、编辑与删除。
 * 复用约定：子菜单与菜单项取 @components/ui 的 dropdown-menu，行尾操作取 @webview/components/Button，
 * 配套的表单与删除确认交给同目录 ImageRuleDialogs，类型取 @shared/types/imagegen。
 * 关键约束：子菜单与弹窗必须分开渲染——菜单收起会卸载子菜单整棵子树，弹窗挂在其内会随之消失；
 * 行尾按钮必须在 pointerdown / pointerup / click 上截断冒泡，否则点一次编辑会连带翻转该行的芯片，
 * 这层拦截统一收在 RuleRowAction 里；Escape 仍要冒泡出去关菜单，故按键只拦截回车与空格。
 */
import { cn } from 'cn'
import { FolderOpen, PencilRuler, Plus, SquarePen, SquareText, Trash2 } from 'lucide-react'
import {
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
} from '@components/ui/dropdown-menu'
import type { PromptRule } from '@shared/types/imagegen'
import { Button } from '@webview/components/Button'
import type { JSX, KeyboardEvent, ReactNode, SyntheticEvent } from 'react'

interface ImageRuleMenuProps {
    /** 已列举的规则：排序与归属由调用方决定 */
    rules: readonly PromptRule[]
    isLoading: boolean
    /** 已挂规则的标识：列表据此回显挂载态 */
    selectedRules: readonly string[]
    /** 点选规则：由输入卡片切换对应芯片 */
    onToggle: (rule: PromptRule) => void
    onEdit: (rule: PromptRule) => void
    onDelete: (rule: PromptRule) => void
    onCreate: () => void
    onOpenDir: () => void
}

/**
 * 行尾操作按钮的事件拦截：Radix 在整行的 pointerdown / pointerup / click 三处都可能派发选中，
 * 任意一处漏掉，点一次「编辑」都会顺带把这条规则挂上或摘掉。
 */
function stopRowSelect(event: SyntheticEvent): void {
    event.stopPropagation()
}

/** 按键只在激活键上截断：Escape 仍要冒泡出去关菜单 */
function stopRowKeySelect(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === 'Enter' || event.key === ' ') {
        event.stopPropagation()
    }
}

interface RuleRowActionProps {
    /** 可访问名：行内只有图标，屏幕阅读器靠它区分动作与目标规则 */
    label: string
    /** 删除等不可逆操作为 true，图标取 destructive 色 */
    isDestructive?: boolean
    onAction: () => void
    children: ReactNode
}

/** 行尾图标按钮：自带整行选中的拦截，编辑与删除只差图标、配色与回调 */
function RuleRowAction({ label, isDestructive = false, onAction, children }: RuleRowActionProps): JSX.Element {
    return (
        <Button
            size="icon-xs"
            variant="ghost"
            className={cn(isDestructive && 'text-destructive')}
            aria-label={label}
            onPointerDown={stopRowSelect}
            onPointerUp={stopRowSelect}
            onKeyDown={stopRowKeySelect}
            onClick={(event) => {
                event.stopPropagation()
                onAction()
            }}
        >
            {children}
        </Button>
    )
}

interface RuleRowProps {
    rule: PromptRule
    /** 该规则是否已挂成芯片 */
    isSelected: boolean
    onToggle: (rule: PromptRule) => void
    onEdit: (rule: PromptRule) => void
    onDelete: (rule: PromptRule) => void
}

/** 规则行：图标 + 名称即整行开关，行尾两个按钮负责编辑与删除 */
function RuleRow({ rule, isSelected, onToggle, onEdit, onDelete }: RuleRowProps): JSX.Element {
    return (
        <DropdownMenuItem
            className={cn('pr-1', isSelected ? 'text-foreground' : 'text-muted-foreground')}
            onSelect={() => onToggle(rule)}
        >
            <SquareText />
            <span className="flex-1 truncate">{rule.name}</span>
            <div className="flex items-center gap-0.5">
                <RuleRowAction label={`编辑${rule.name}`} onAction={() => onEdit(rule)}>
                    <SquarePen />
                </RuleRowAction>
                <RuleRowAction label={`删除${rule.name}`} isDestructive onAction={() => onDelete(rule)}>
                    <Trash2 />
                </RuleRowAction>
            </div>
        </DropdownMenuItem>
    )
}

/** 规则子菜单：列表 + 新建入口 + 打开目录，必须渲染在下拉菜单内 */
export function ImageRuleMenu({
    rules,
    isLoading,
    selectedRules,
    onToggle,
    onEdit,
    onDelete,
    onCreate,
    onOpenDir,
}: ImageRuleMenuProps): JSX.Element {
    return (
        <DropdownMenuSub>
            <DropdownMenuSubTrigger>
                <PencilRuler />
                <span className="flex-1">规则</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-60">
                {rules.length > 0 ? (
                    /* 滚动交给内层：外层不滚动，毛玻璃底色与描边才不会随内容滚出可视区 */
                    <div className="max-h-64 overflow-x-hidden overflow-y-auto">
                        {rules.map((rule) => (
                            <RuleRow
                                key={rule.id}
                                rule={rule}
                                isSelected={selectedRules.includes(rule.id)}
                                onToggle={onToggle}
                                onEdit={onEdit}
                                onDelete={onDelete}
                            />
                        ))}
                    </div>
                ) : (
                    <DropdownMenuItem disabled>{isLoading ? '读取中…' : '暂无规则'}</DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onCreate}>
                    <Plus />
                    新建规则…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onOpenDir}>
                    <FolderOpen />
                    打开规则目录
                </DropdownMenuItem>
            </DropdownMenuSubContent>
        </DropdownMenuSub>
    )
}
