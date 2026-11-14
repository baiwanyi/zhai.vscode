/**
 * 块把手的插入菜单：列出与「/」菜单同源的块命令，选中后先把光标移出目标块再执行。
 * 复用约定：命令清单取 slash/slashCommands，菜单壳取 @components/ui/dropdown-menu，
 * 关闭后的焦点交回正文由 focusPolicy 统一处理。
 * 关键约束：目标块由把手在打开瞬间冻结后传入——不能在这里读选区，选区往往还停在文末，
 * 那样无论在哪一行的把手上插入，内容都会跑到文档最后；
 * 落点分两类：插入型命令把光标放到目标块内容末尾，让节点落在这一行之后；
 * 转换型命令（标题 / 列表 / 引用 / 代码块）先在目标块之后开一个空段落再套用，
 * 否则 toggle 语义会把用户正在读的那一行就地改掉，而不是在它后面新增一行；
 * 下一块已是空段落时直接复用，避免每插入一次就多叠一行空行；
 * 关闭时若把焦点还给插入按钮，表情命令随后打开的长驻浮层会当场关闭，表现为「点了没反应」。
 */
import { CirclePlus } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@components/ui/dropdown-menu'
import { Button } from '@webview/components/Button'
import { readBlockNode } from './blockQueries'
import type { SlashCommand } from '../slash/slashCommands'
import type { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { JSX } from 'react'
import { returnFocusToEditor } from '../core/focusPolicy'
import { SLASH_COMMANDS } from '../slash/slashCommands'

export interface InsertBlockMenuProps {
    editor: Editor
    /** 目标块起始位置：菜单打开瞬间冻结为把手悬停的那一块，为 null 时命令不执行 */
    pos: number | null
    isOpen: boolean
    onOpenChange: (isOpen: boolean) => void
}

export function InsertBlockMenu({ editor, pos, isOpen, onOpenChange }: InsertBlockMenuProps): JSX.Element {
    /**
     * 在目标块之后准备一个空段落并把光标放进去：转换型命令由此落在新行上，原块保持不动。
     * 下一块本身就是空段落时直接复用——再插一个只会在文档里多叠一行空行。
     */
    const focusNextBlock = (pos: number, node: ProseMirrorNode): boolean => {
        const paragraphType = editor.schema.nodes.paragraph
        if (paragraphType === undefined) {
            return false
        }
        const after = pos + node.nodeSize
        const next = editor.state.doc.nodeAt(after)
        const canReuse = next !== null && next.type === paragraphType && next.content.size === 0
        if (!canReuse) {
            // 块边界插入段落合法：doc 的 content 是 block+，空文档也就多出这一行
            editor.chain().insertContentAt(after, paragraphType.create()).run()
        }
        editor.chain().focus(after + 1).run()
        return true
    }

    /** 执行命令：把光标移到目标块之后，命令不再作用到用户正在读的那一行 */
    const runCommand = (command: SlashCommand): void => {
        const node = pos === null ? null : readBlockNode(editor, pos)
        if (pos === null || node === null) {
            return
        }
        if (command.kind === 'convert' && node.isTextblock) {
            if (!focusNextBlock(pos, node)) {
                return
            }
        } else {
            // 文本块落在内容末尾，块级节点（表格、图片）落到节点之后；两者都由命令自己拆分段落
            const target = node.isTextblock ? pos + node.nodeSize - 1 : pos + node.nodeSize
            editor.chain().focus(target).run()
        }
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
