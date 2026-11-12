/**
 * 块把手：按悬停块的内容分两种形态——空行给插入按钮（菜单与 `/` 命令同源），有内容行给拖拽手柄。
 * 复用约定：DragHandle 负责悬停定位与整块拖拽，DropdownMenu 负责命令，菜单项直接复用 SLASH_COMMANDS。
 * 关键约束：容器宽度必须固定（w-12）——DragHandle 按元素宽度算左侧坐标，宽度随形态变化会让把手左右跳动；
 * 容器右侧留 12px 内边距，让按钮与正文之间保持间距，不至于贴着文字；
 * 空行判定按「无可见文本 + 无实体节点」，只含空格或硬换行的行同样算空行，不再给出拖拽手柄；
 * 对齐基准是块的「首行矩形」而不是整块：多行段落居中对齐会让按钮掉到两行之间；
 * 定位配置必须是模块级常量，内联对象每次渲染都会换引用，DragHandle 会反复重注册插件；
 * 鼠标不在块上时用 invisible 收起而不是卸载，同理是为了保持定位宽度稳定；
 * 菜单打开期间必须锁住拖拽，否则 Radix 的 pointerdown 会被原生 dragstart 抢占；
 * 命令执行前先把光标移进悬停的空行，否则表格、分隔线这类插入命令会落到上一次光标所在的块。
 */
import { DragHandle } from '@tiptap/extension-drag-handle-react'
import { cn } from 'cn'
import { CirclePlus, GripVertical } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { Button } from '@webview/components/Button'
import { isBlankBlock } from './blockContent'
import type { SlashCommand } from '../toolbar/slashCommands'
import type { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { ComponentProps, JSX } from 'react'
import { SLASH_COMMANDS } from '../toolbar/slashCommands'

export interface BlockHandleProps {
    editor: Editor
}

/** 把手容器：固定 48px 槽位，两种形态在同一位置切换；pr-3 让按钮离正文 14px */
const HANDLE_CLASS = 'flex w-12 items-center justify-center rounded border bg-background py-px pr-3 shadow-sm'

/** 把手定位：left 表示贴参考元素左侧并垂直居中，参考元素是下面算出的「块首行」 */
const HANDLE_POSITION: NonNullable<ComponentProps<typeof DragHandle>['computePositionConfig']> = {
    placement: 'left',
    strategy: 'absolute',
}

/**
 * 块首行的视口矩形：把手要对齐第一行，不能按整块的垂直中线——
 * 多行段落若居中对齐，按钮会掉到两行文字之间，看不出它在拖哪一块。
 * 取首个文本节点的首字符测行盒；空块、图片这类没有文本的块退回整块矩形。
 */
function firstLineRect(element: HTMLElement): DOMRect {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const textNode = walker.nextNode()
    const text = textNode?.textContent ?? ''
    if (textNode === null || text.length === 0) {
        return element.getBoundingClientRect()
    }
    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, 1)
    const rect = range.getBoundingClientRect()
    return rect.height > 0 ? rect : element.getBoundingClientRect()
}

/**
 * 锁定 / 解锁把手拖拽：drag-handle 的 React 版扩展通过 registerPlugin 注册，命令不在 editor.commands 类型里，
 * 因此直接派发同名事务 meta；meta 不改文档，不会污染撤销栈。
 */
function setDragLocked(editor: Editor, isLocked: boolean): void {
    if (editor.isDestroyed) {
        return
    }
    editor.view.dispatch(editor.state.tr.setMeta('lockDragHandle', isLocked))
}

export function BlockHandle({ editor }: BlockHandleProps): JSX.Element {
    // 悬停块：null 表示指针不在任何块上；空行只给插入按钮，有内容才给拖拽手柄
    const [hoverNode, setHoverNode] = useState<ProseMirrorNode | null>(null)
    const [isMenuOpen, setIsMenuOpen] = useState(false)
    // 悬停块在文档中的位置：命令执行前把光标移进来，避免插入类命令落到旧光标处
    const linePosRef = useRef<number | null>(null)
    // 悬停块的位置：定位时用它取块 DOM，再测首行矩形
    const blockPosRef = useRef<number | null>(null)

    const isEmptyLine = hoverNode !== null && isBlankBlock(hoverNode)

    // 卸载时兜底解锁：菜单开着被移除（例如源模式切换）时不会再触发 onOpenChange
    useEffect(() => {
        return (): void => {
            setDragLocked(editor, false)
        }
    }, [editor])

    /** 悬停块变化：DragHandle 在移出正文时回调 node 为 null */
    const handleNodeChange = ({ node, pos }: { node: ProseMirrorNode | null; pos: number }): void => {
        linePosRef.current = node !== null && isBlankBlock(node) ? pos : null
        blockPosRef.current = node === null ? null : pos
        setHoverNode((previous) => (previous === node ? previous : node))
    }

    /** 定位参考元素：把悬停块的 DOM 包成首行矩形，DragHandle 据此算左侧坐标 */
    const getReferencedElement = (): { getBoundingClientRect: () => DOMRect } | null => {
        const pos = blockPosRef.current
        if (pos === null || editor.isDestroyed) {
            return null
        }
        const dom = editor.view.nodeDOM(pos)
        if (!(dom instanceof HTMLElement)) {
            return null
        }
        return { getBoundingClientRect: (): DOMRect => firstLineRect(dom) }
    }

    /** 菜单开合与拖拽互斥：打开即锁，关闭即解锁 */
    const handleMenuOpenChange = (isOpen: boolean): void => {
        setIsMenuOpen(isOpen)
        setDragLocked(editor, isOpen)
    }

    /** 执行斜杠命令：先把光标定位到悬停的空行，再交给命令自己的链 */
    const runCommand = (command: SlashCommand): void => {
        const pos = linePosRef.current
        if (pos === null) {
            return
        }
        editor.chain().setTextSelection(pos + 1).run()
        command.run(editor, null)
    }

    return (
        <DragHandle
            editor={editor}
            computePositionConfig={HANDLE_POSITION}
            getReferencedVirtualElement={getReferencedElement}
            onNodeChange={handleNodeChange}
        >
            <div className={cn(HANDLE_CLASS, hoverNode === null && 'invisible')}>
                {isEmptyLine ? (
                    <DropdownMenu open={isMenuOpen} onOpenChange={handleMenuOpenChange}>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-xs" tooltip="插入 / 转换为" tooltipSide="right">
                                <CirclePlus className="size-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent side="right" align="start" className="w-64">
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
                ) : (
                    <GripVertical className="size-4 cursor-grab text-muted-foreground" aria-hidden="true" />
                )}
            </div>
        </DragHandle>
    )
}
