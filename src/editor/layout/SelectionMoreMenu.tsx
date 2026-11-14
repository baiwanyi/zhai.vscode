/**
 * 选区工具条的「更多」菜单：收纳不常用且会改变块结构的操作。
 * 复用约定：菜单壳用 @components/ui/dropdown-menu，命令取自 selection/formatCommands，
 * 目标范围由外层冻结后传入，菜单内不现读选区。
 * 关键约束：清除格式会同时摘掉内联标记并把标题、列表回落为正文——这是唯一能保证
 * 回写结果仍在 GFM 内的「重置」手段；上下标、对齐、缩进没有对应语法，故不设入口；
 * 执行后必须把焦点交回正文，否则浮层收起后光标不在编辑器里；
 * 必须 modal={false}：与块类型菜单同理，嵌在选区浮层里的模态菜单会让整片界面点不动。
 */
import { EllipsisVertical, RemoveFormatting } from 'lucide-react'
import { useState } from 'react'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { Button } from '@webview/components/Button'
import type { FrozenRange } from '../selection/formatCommands'
import type { Editor } from '@tiptap/react'
import type { JSX } from 'react'
import { ensureEditable } from '../core/editableGuard'
import { clearSelectionFormatting } from '../selection/formatCommands'

export interface SelectionMoreMenuProps {
    editor: Editor
    /** 冻结的选区范围 */
    range: FrozenRange
    /** 受控开合：不传时菜单自持状态（父层不需要读它，只有点击外部判定靠 DOM 归属） */
    isOpen?: boolean
    onOpenChange?: (isOpen: boolean) => void
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
    const [isSelfOpen, setIsSelfOpen] = useState(false)
    const isMenuOpen = isOpen ?? isSelfOpen
    /** 自持与受控共用一条写入路径：受控时仍回调，方便调用方按需接管 */
    const handleOpenChange = (nextOpen: boolean): void => {
        setIsSelfOpen(nextOpen)
        onOpenChange?.(nextOpen)
    }

    const handleClear = (): void => {
        // 只读文档下命令层会静默 return，浮层却照常收起：先说明原因，别让用户以为已经清干净
        if (!ensureEditable(editor)) {
            return
        }
        // 焦点由命令链自己交回正文（runAtRange 以 focus 开头），这里不再重复 focus
        clearSelectionFormatting(editor, range)
        onApplied()
    }

    return (
        // modal 必须关掉：本菜单挂在选区浮层（Popover）内部，Radix 的模态菜单会在 body 上
        // 挂 pointer-events: none 并抢焦点，浮层内外的按钮与正文会一起点不动
        <DropdownMenu modal={false} open={isMenuOpen} onOpenChange={handleOpenChange}>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="更多" aria-expanded={isMenuOpen}>
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
