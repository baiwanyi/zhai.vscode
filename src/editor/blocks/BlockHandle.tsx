/**
 * 块把手：左侧图标负责拖拽重排，右侧按钮展开「转换为」与表格操作。
 * 复用约定：DragHandle 负责拖拽与定位，DropdownMenu 负责命令；转换命令复用 slashCommands 的
 * TURN_INTO_COMMANDS，不为「转换」再写一套命令。
 * 关键约束：拖拽与菜单必须拆成两个元素——把菜单挂在拖拽元素上时，Radix 的 pointerdown 与
 * DragHandle 的拖拽起点会互相抢占，表现为「点不开」或「拖不动」；
 * 表格操作只在光标位于表格内时出现，否则会给出无效命令。
 */
import { DragHandle } from '@tiptap/extension-drag-handle-react'
import { ChevronDown, GripVertical } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { Button } from '@webview/components/Button'
import type { Editor } from '@tiptap/core'
import type { JSX } from 'react'
import { TURN_INTO_COMMANDS } from '../toolbar/slashCommands'

export interface BlockHandleProps {
    editor: Editor
}

/** 表格内可用的结构操作：增删行列与表头开关，缺了它们表格只能插入不能改 */
const TABLE_ACTIONS: ReadonlyArray<{ label: string; run: (editor: Editor) => void }> = [
    { label: '上方插入行', run: (editor) => editor.chain().focus().addRowBefore().run() },
    { label: '下方插入行', run: (editor) => editor.chain().focus().addRowAfter().run() },
    { label: '左侧插入列', run: (editor) => editor.chain().focus().addColumnBefore().run() },
    { label: '右侧插入列', run: (editor) => editor.chain().focus().addColumnAfter().run() },
    { label: '删除当前行', run: (editor) => editor.chain().focus().deleteRow().run() },
    { label: '删除当前列', run: (editor) => editor.chain().focus().deleteColumn().run() },
    { label: '切换表头行', run: (editor) => editor.chain().focus().toggleHeaderRow().run() },
    { label: '删除表格', run: (editor) => editor.chain().focus().deleteTable().run() },
]

export function BlockHandle({ editor }: BlockHandleProps): JSX.Element {
    // 初值直接问编辑器：放在 effect 里同步 setState 会多一轮渲染
    const [isInTable, setIsInTable] = useState((): boolean => editor.isActive('table'))

    // 光标进出表格时更新菜单内容：只在状态真变时 setState，避免每次输入都触发渲染
    useEffect(() => {
        const update = (): void => {
            const isNext = editor.isActive('table')
            setIsInTable((previous) => (previous === isNext ? previous : isNext))
        }
        editor.on('transaction', update)
        return (): void => {
            editor.off('transaction', update)
        }
    }, [editor])

    return (
        <DragHandle editor={editor}>
            <div className="flex items-center gap-0.5 rounded border bg-background px-0.5 py-px shadow-sm">
                <GripVertical className="size-3.5 cursor-grab text-muted-foreground" aria-hidden="true" />
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-xs" tooltip="转换为 / 表格操作" tooltipSide="right">
                            <ChevronDown className="size-3" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="right" align="start" className="w-44">
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
                        {isInTable ? (
                            <>
                                <DropdownMenuSeparator />
                                {TABLE_ACTIONS.map((action) => (
                                    <DropdownMenuItem
                                        key={action.label}
                                        onSelect={(): void => {
                                            action.run(editor)
                                        }}
                                    >
                                        {action.label}
                                    </DropdownMenuItem>
                                ))}
                            </>
                        ) : null}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </DragHandle>
    )
}
