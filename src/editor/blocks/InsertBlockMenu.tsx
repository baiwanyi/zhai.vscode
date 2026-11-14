/**
 * 块把手的插入菜单：列出与「/」菜单同源的块命令，选中后先把光标移出当前块再执行。
 * 复用约定：命令清单取 toolbar/slashCommands，菜单壳取 @components/ui/dropdown-menu，
 * 关闭后的焦点交回正文由 focusPolicy 统一处理。
 * 关键约束：插入命令必须先把光标移到当前块内容末尾，否则会插进行内而不是行后；
 * 关闭时若把焦点还给插入按钮，表情命令随后打开的长驻浮层会当场关闭，表现为「点了没反应」。
 */
import { CirclePlus } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@components/ui/dropdown-menu'
import { Button } from '@webview/components/Button'
import { readTopBlockPos } from './blockQueries'
import type { SlashCommand } from '../toolbar/slashCommands'
import type { Editor } from '@tiptap/core'
import type { JSX } from 'react'
import { returnFocusToEditor } from '../focusPolicy'
import { SLASH_COMMANDS } from '../toolbar/slashCommands'

export interface InsertBlockMenuProps {
    editor: Editor
    isOpen: boolean
    onOpenChange: (isOpen: boolean) => void
}

export function InsertBlockMenu({ editor, isOpen, onOpenChange }: InsertBlockMenuProps): JSX.Element {
    /** 执行命令：把光标移到当前块之后，插入类命令不再插进行内 */
    const runCommand = (command: SlashCommand): void => {
        const pos = readTopBlockPos(editor)
        const node = pos === null ? null : editor.state.doc.nodeAt(pos)
        if (pos === null || node === null) {
            return
        }
        // 文本块落在内容末尾，块级节点（表格、图片）落到节点之后；两者都由命令自己拆分段落
        const target = node.isTextblock ? pos + node.nodeSize - 1 : pos + node.nodeSize
        editor.chain().focus(target).run()
        command.run(editor, null)
    }

    return (
        <DropdownMenu open={isOpen} onOpenChange={onOpenChange}>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="w-6" tooltip="插入块">
                    <CirclePlus className="size-3.5" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                side="right"
                align="start"
                className="w-64"
                onCloseAutoFocus={returnFocusToEditor(editor)}
            >
                {SLASH_COMMANDS.map((command) => (
                    <DropdownMenuItem
                        key={command.id}
                        onSelect={(): void => {
                            runCommand(command)
                        }}
                    >
                        <command.icon className="size-4" />
                        {command.label}
                        {/* 说明文字与 `/` 菜单同源，两处看到的项目完全一致 */}
                        <span className="ml-auto text-xs text-muted-foreground">{command.hint}</span>
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
