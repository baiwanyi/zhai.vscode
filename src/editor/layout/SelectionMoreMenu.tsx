/**
 * 选区工具条的「更多」菜单：收纳不常用且会改变块结构的操作。
 * 复用约定：菜单壳用 @components/ui/dropdown-menu，命令取自 toolbar/formatCommands，
 * 目标范围由外层冻结后传入，菜单内不现读选区。
 * 关键约束：清除格式会同时摘掉内联标记并把标题、列表回落为正文——这是唯一能保证
 * 回写结果仍在 GFM 内的「重置」手段；上下标、对齐、缩进没有对应语法，故不设入口；
 * 执行后必须把焦点交回正文，否则浮层收起后光标不在编辑器里；
 * 必须 modal={false}：与块类型菜单同理，嵌在选区浮层里的模态菜单会让整片界面点不动。
 */
import { EllipsisVertical, RemoveFormatting } from 'lucide-react'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { Button } from '@webview/components/Button'
import type { FrozenRange } from '../toolbar/formatCommands'
import type { Editor } from '@tiptap/core'
import type { JSX } from 'react'
import { clearSelectionFormatting } from '../toolbar/formatCommands'

export interface SelectionMoreMenuProps {
    editor: Editor
    /** 冻结的选区范围 */
    range: FrozenRange
    isOpen: boolean
    onOpenChange: (isOpen: boolean) => void
    /** 命令执行完成：外层据此收起整个浮层 */
    onApplied: () => void
}

export function SelectionMoreMenu({
    editor,
    range,
    isOpen,
    onOpenChange,
    onApplied,
}: SelectionMoreMenuProps): JSX.Element {
    const handleClear = (): void => {
        clearSelectionFormatting(editor, range)
        editor.view.focus()
        onApplied()
    }

    return (
        // modal 必须关掉：本菜单挂在选区浮层（Popover）内部，Radix 的模态菜单会在 body 上
        // 挂 pointer-events: none 并抢焦点，浮层内外的按钮与正文会一起点不动
        <DropdownMenu modal={false} open={isOpen} onOpenChange={onOpenChange}>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="更多" aria-expanded={isOpen}>
                    <EllipsisVertical className="size-3.5" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                side="bottom"
                align="end"
                className="w-40"
                onCloseAutoFocus={(event): void => {
                    // 焦点由命令自己交回正文，菜单不许抢回
                    event.preventDefault()
                }}
            >
                <DropdownMenuLabel>选区</DropdownMenuLabel>
                <DropdownMenuItem onSelect={handleClear}>
                    <RemoveFormatting />
                    清除格式
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
