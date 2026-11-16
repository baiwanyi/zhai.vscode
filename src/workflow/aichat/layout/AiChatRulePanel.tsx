/**
 * 「添加上下文」面板里的规则视图：列出现存规则、挂载状态与新建 / 打开目录入口。
 * 复用约定：数据与增删改由工具行的 useRuleMenu 承担，本组件只渲染列表并上报动作；
 * 类型取 @shared/types/promptLibrary，与出图侧规则菜单读同一个 prompt/rules 目录。
 * 关键约束：行用普通 Button 而不是 DropdownMenuItem——本视图渲染在 Popover 内，
 * 下拉菜单的键盘导航在浮层里没有上下文；行尾操作必须截断冒泡，否则点编辑会连带切换挂载态。
 */
import { cn } from 'cn'
import { FolderOpen, Plus, SquarePen, SquareText, Trash2 } from 'lucide-react'
import type { PromptRule } from '@shared/types/promptLibrary'
import { Button } from '@webview/components/Button'
import type { JSX, MouseEvent } from 'react'

interface AiChatRulePanelProps {
    rules: readonly PromptRule[]
    isLoading: boolean
    /** 已挂规则名：列表据此回显挂载态 */
    selectedRules: readonly string[]
    onToggle: (rule: PromptRule) => void
    onEdit: (rule: PromptRule) => void
    onDelete: (rule: PromptRule) => void
    onCreate: () => void
    onOpenDir: () => void
}

/** 行尾图标按钮：截断冒泡，避免点一次编辑顺带把整行切换掉 */
function RowAction({
    label,
    isDestructive = false,
    onAction,
    children,
}: {
    label: string
    isDestructive?: boolean
    onAction: () => void
    children: JSX.Element
}): JSX.Element {
    return (
        <Button
            size="icon-xs"
            variant="ghost"
            className={cn(isDestructive && 'text-destructive')}
            aria-label={label}
            onClick={(event: MouseEvent): void => {
                event.stopPropagation()
                onAction()
            }}
        >
            {children}
        </Button>
    )
}

export function AiChatRulePanel({
    rules,
    isLoading,
    selectedRules,
    onToggle,
    onEdit,
    onDelete,
    onCreate,
    onOpenDir,
}: AiChatRulePanelProps): JSX.Element {
    return (
        <>
            <div className="max-h-72 overflow-x-hidden overflow-y-auto overscroll-contain">
                {rules.length === 0 ? (
                    <div className="px-1.5 py-1.5 text-xs text-muted-foreground">
                        {isLoading ? '读取中…' : '暂无规则，可在下面的新建或打开目录手写 md'}
                    </div>
                ) : (
                    rules.map((rule) => {
                        const isSelected = selectedRules.includes(rule.name)
                        return (
                            <div key={rule.id} className="flex items-center">
                                <Button
                                    variant="ghost"
                                    className={cn(
                                        'h-auto min-w-0 flex-1 justify-start gap-1.5 rounded-md px-1.5 py-1 text-left text-sm font-normal',
                                        isSelected ? 'text-foreground' : 'text-muted-foreground',
                                    )}
                                    onClick={() => onToggle(rule)}
                                >
                                    <SquareText className="size-3.5 shrink-0" />
                                    <span className="min-w-0 flex-1 truncate">{rule.name}</span>
                                </Button>
                                <div className="flex shrink-0 items-center gap-0.5 pr-1">
                                    <RowAction label={`编辑${rule.name}`} onAction={() => onEdit(rule)}>
                                        <SquarePen />
                                    </RowAction>
                                    <RowAction label={`删除${rule.name}`} isDestructive onAction={() => onDelete(rule)}>
                                        <Trash2 />
                                    </RowAction>
                                </div>
                            </div>
                        )
                    })
                )}
            </div>
            <div className="-mx-1 my-1 h-px bg-border" role="separator" />
            <Button
                variant="ghost"
                className="h-auto w-full justify-start gap-1.5 rounded-md px-1.5 py-1 text-sm font-normal"
                onClick={onCreate}
            >
                <Plus className="size-3.5 shrink-0" />
                新建规则
            </Button>
            <Button
                variant="ghost"
                className="h-auto w-full justify-start gap-1.5 rounded-md px-1.5 py-1 text-sm font-normal"
                onClick={onOpenDir}
            >
                <FolderOpen className="size-3.5 shrink-0" />
                打开规则目录
            </Button>
        </>
    )
}
