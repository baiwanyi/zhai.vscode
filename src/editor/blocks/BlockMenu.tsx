/**
 * 块把手菜单：块类型标签、转换类型子菜单，以及复制 / AI / 删除三项块级操作。
 * 复用约定：菜单结构取 @components/ui/dropdown-menu，命令全部委托 ./blockCommands，
 * 复制走 @shared/utils/clipboard，操作结果用 sonner 提示（编辑器入口统一挂 Toaster）。
 * 关键约束：pos 由把手在打开瞬间冻结后传入，菜单内不再读选区，避免鼠标离开块时目标漂移；
 * 触发按钮不在这里渲染——Radix 的 Trigger 会在 pointerdown 上 preventDefault，把原生 dragstart 压掉，
 * 按住拖动就失效了；这里只放一个与按钮等尺寸的透明锚点负责定位，开合由把手的按钮自己控制；
 * 删除项不能用 MenuItem 的 destructive variant：Content 上带 !important 的
 * `**:data-[variant=destructive]:text-accent-foreground` 会把红色压成普通文字色，只能自己补 important 类；
 * 快捷键文字只做视觉对齐、没有注册全局键位，Backspace 按下仍由编辑器原生处理；
 * 不可转换的块整组置灰——宁可不给，也不能把表格、图片的结构改坏；
 * 关闭时阻止 Radix 把焦点还给锚点并主动聚焦正文，否则点完菜单光标就消失。
 */
import { Copy, CopyPlus, Sparkles, Trash2, Type } from 'lucide-react'
import { toast } from 'sonner'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuShortcut,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { copyToClipboard } from '@shared/utils/clipboard'
import {
    BLOCK_TARGETS,
    canConvertBlock,
    convertBlock,
    deleteBlock,
    duplicateBlock,
    isCurrentTarget,
    readBlockLabel,
    readBlockNode,
    readBlockText,
} from './blockCommands'
import type { Editor } from '@tiptap/core'
import type { JSX } from 'react'

/** 删除项的快捷键提示：仅展示，不注册键位（见文件头约束） */
const SHORTCUT_DELETE = 'Backspace'

export interface BlockMenuProps {
    editor: Editor
    /** 目标块起始位置：菜单打开瞬间冻结，为 null 时全部条目置灰 */
    pos: number | null
    isOpen: boolean
    onOpenChange: (isOpen: boolean) => void
    /** 询问 AI：把块文本交给编辑器现有的查询弹窗 */
    onAskAi: (quote: string) => void
}

export function BlockMenu({ editor, pos, isOpen, onOpenChange, onAskAi }: BlockMenuProps): JSX.Element {
    const node = pos === null ? null : readBlockNode(editor, pos)
    const text = node === null ? '' : readBlockText(node)
    const isConvertible = node !== null && canConvertBlock(node)
    const isBlank = text.trim().length === 0

    /** 复制块文本：空块不给复制，避免把空串写进剪贴板后用户毫无感知 */
    const handleCopy = async (): Promise<void> => {
        if (isBlank) {
            toast.error('这个块没有可复制的文本')
            return
        }
        const isCopied = await copyToClipboard(text)
        if (isCopied) {
            toast.success('已复制块内容')
            return
        }
        toast.error('剪贴板不可用，复制失败')
    }

    return (
        <DropdownMenu open={isOpen} onOpenChange={onOpenChange}>
            <DropdownMenuTrigger asChild>
                {/* 纯锚点：尺寸与把手按钮一致，只给 Radix 算弹出坐标，指针事件一律穿透到按钮上 */}
                <span aria-hidden className="pointer-events-none absolute inset-0" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
                side="right"
                align="start"
                className="w-56"
                onCloseAutoFocus={(event): void => {
                    // 默认行为会把焦点送回锚点，正文随即失焦；这里改由编辑器接管
                    event.preventDefault()
                    editor.chain().focus().run()
                }}
            >
                <DropdownMenuLabel>{node === null ? '块' : readBlockLabel(node)}</DropdownMenuLabel>
                <DropdownMenuSub>
                    <DropdownMenuSubTrigger disabled={!isConvertible}>
                        <Type />
                        <span className="flex-1">转换类型</span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-40">
                        {BLOCK_TARGETS.map((target) => {
                            const Icon = target.icon
                            return (
                                <DropdownMenuItem
                                    key={target.id}
                                    disabled={!isConvertible || (node !== null && isCurrentTarget(node, target.id))}
                                    onSelect={(): void => {
                                        if (pos === null) {
                                            return
                                        }
                                        convertBlock(editor, pos, target.id)
                                    }}
                                >
                                    <Icon />
                                    {target.label}
                                </DropdownMenuItem>
                            )
                        })}
                    </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    disabled={node === null}
                    onSelect={(): void => {
                        if (pos === null) {
                            return
                        }
                        duplicateBlock(editor, pos)
                    }}
                >
                    <CopyPlus />
                    复制块
                </DropdownMenuItem>
                <DropdownMenuItem
                    disabled={node === null}
                    onSelect={(): void => {
                        void handleCopy()
                    }}
                >
                    <Copy />
                    复制文本
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    disabled={isBlank}
                    onSelect={(): void => {
                        if (isBlank) {
                            return
                        }
                        onAskAi(text)
                    }}
                >
                    <Sparkles />
                    询问 AI
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    className="text-destructive! [&_svg]:text-destructive!"
                    disabled={node === null}
                    onSelect={(): void => {
                        if (pos === null) {
                            return
                        }
                        deleteBlock(editor, pos)
                    }}
                >
                    <Trash2 />
                    删除
                    <DropdownMenuShortcut>{SHORTCUT_DELETE}</DropdownMenuShortcut>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
