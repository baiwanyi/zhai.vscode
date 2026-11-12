/**
 * 块把手：左侧图标负责拖拽重排，右侧按钮展开「转换为」菜单。
 * 复用约定：DragHandle 负责拖拽与定位，DropdownMenu 负责类型转换；
 * 转换命令复用 slashCommands 的 TURN_INTO_COMMANDS，不为「转换」再写一套命令。
 * 关键约束：拖拽与菜单必须拆成两个元素——把菜单挂在拖拽元素上时，
 * Radix 的 pointerdown 与 DragHandle 的拖拽起点会互相抢占，表现为「点不开」或「拖不动」。
 */
import { DragHandle } from '@tiptap/extension-drag-handle-react'
import { ChevronDown, GripVertical } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@components/ui/dropdown-menu'
import { Button } from '@webview/components/Button'
import type { Editor } from '@tiptap/core'
import type { JSX } from 'react'
import { TURN_INTO_COMMANDS } from '../toolbar/slashCommands'

export interface BlockHandleProps {
    editor: Editor
}

export function BlockHandle({ editor }: BlockHandleProps): JSX.Element {
    return (
        <DragHandle editor={editor}>
            <div className="flex items-center gap-0.5 rounded border bg-background px-0.5 py-px shadow-sm">
                <GripVertical className="size-3.5 cursor-grab text-muted-foreground" aria-hidden="true" />
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-xs" tooltip="转换为" tooltipSide="right">
                            <ChevronDown className="size-3" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="right" align="start" className="w-40">
                        {TURN_INTO_COMMANDS.map((command) => (
                            <DropdownMenuItem
                                key={command.id}
                                onSelect={(): void => {
                                    command.run(editor, null)
                                }}
                            >
                                <command.icon className="size-4" />
                                {command.label}
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </DragHandle>
    )
}
