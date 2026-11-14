/**
 * 块把手菜单：块类型标签、转换类型子菜单（表格块换成表格结构操作子菜单），
 * 以及复制 / 询问 AI / 加入对话 / 删除四项块级操作。
 * 复用约定：菜单结构取 @components/ui/dropdown-menu，块级命令委托 ./blockConversion 与 ./blockMutations，
 * 表格结构操作整体交给 ./TableBlockMenuItems，复制提示走 @shared/utils/clipboard 的 copyWithToast，
 * 只读守卫走 ../core/editableGuard；加入对话只把块文本交给宿主，定位与去重都在宿主侧完成。
 * 关键约束：pos 由把手在打开瞬间冻结后传入，菜单内不再读选区，避免鼠标离开块时目标漂移；
 * 触发按钮不在这里渲染——Radix 的 Trigger 会在 pointerdown 上 preventDefault，把原生 dragstart 压掉，
 * 按住拖动就失效了；这里只放一个与按钮等尺寸的透明锚点负责定位，开合由把手的按钮自己控制；
 * 删除表格块时直接删表，但整篇只剩这一张表时仍需保留一个空段落，否则事务会被 schema 拒绝；
 * 关闭后的焦点归属由调用方经 onClosed 决定：菜单只是执行者，开合的所有者是把手；
 * 快捷键文字只做视觉对齐、没有注册全局键位，Backspace 按下仍由编辑器原生处理。
 */
import { Copy, CopyPlus, MessageSquarePlus, Sparkles, Trash2, Type } from 'lucide-react'
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
import { copyWithToast } from '@shared/utils/clipboard'
import { canConvertBlock, convertBlock } from './blockConversion'
import { deleteBlock, duplicateBlock } from './blockMutations'
import { readBlockIndex, readBlockNode, readBlockText } from './blockQueries'
import { readBlockLabel, readConvertTargetStates } from './blockTargets'
import { runTableStructureAction } from './tableBlockActions'
import { TableBlockMenuItems } from './TableBlockMenuItems'
import type { Editor } from '@tiptap/core'
import type { JSX } from 'react'
import { ensureEditable } from '../core/editableGuard'

/** 删除项的快捷键提示：仅展示，不注册键位（见文件头约束） */
const SHORTCUT_DELETE = 'Backspace'

/** 表格块的类型名：命中时子菜单换成表格结构操作，删除项改走删表 */
const TABLE_NODE = 'table'

export interface BlockMenuProps {
    editor: Editor
    /** 目标块起始位置：菜单打开瞬间冻结，为 null 时全部条目置灰 */
    pos: number | null
    isOpen: boolean
    onOpenChange: (isOpen: boolean) => void
    /** 关闭后的焦点归属：由把手决定（它才是菜单开合的所有者），本组件不做策略 */
    onClosed: () => void
    /** 询问 AI：把块文本交给编辑器现有的查询弹窗 */
    onAskAi: (quote: string) => void
    /** 加入 AI 对话：块文本 + 顶层序号交给宿主，换算成行范围后成为对话的上下文引用 */
    onAddToChat: (quote: string, blockIndex: number) => void
}

export function BlockMenu({
    editor,
    pos,
    isOpen,
    onOpenChange,
    onClosed,
    onAskAi,
    onAddToChat,
}: BlockMenuProps): JSX.Element {
    const node = pos === null ? null : readBlockNode(editor, pos)
    const text = node === null ? '' : readBlockText(node)
    // 菜单关闭时 Content 根本不挂载，这个派生值无人消费；canConvertBlock 会递归整块并创建节点，
    // 而父组件在 AI 流式输出期间会频繁重渲染，关闭态下能省则省
    const isConvertible = isOpen && node !== null && canConvertBlock(node)
    const isTable = node !== null && node.type.name === TABLE_NODE
    const isBlank = text.trim().length === 0
    // 「当前项」判定与选区块类型菜单共用；本菜单把当前项渲染成置灰而不是打勾
    const convertTargets = readConvertTargetStates(node)

    /** 复制块文本：空块不给复制，避免把空串写进剪贴板后用户毫无感知；只读态照常可复制 */
    const handleCopy = async (): Promise<void> => {
        if (isBlank) {
            toast.error('这个块没有可复制的文本')
            return
        }
        await copyWithToast(text, '已复制块内容')
    }

    /** 复制块：只读文档下命令层会静默返回 false，先把原因说出来 */
    const handleDuplicate = (): void => {
        if (pos === null || !ensureEditable(editor)) {
            return
        }
        duplicateBlock(editor, pos)
    }

    /** 删除块：表格块直接删表，其余块交给 deleteBlock */
    const handleDelete = (): void => {
        if (pos === null || !ensureEditable(editor)) {
            return
        }
        // 整篇只剩这一张表时不能删表：空文档会被 schema 拒绝，退回 deleteBlock 换成空段落
        if (isTable && editor.state.doc.childCount > 1) {
            runTableStructureAction(editor, pos, (target): boolean => target.chain().focus().deleteTable().run())
            return
        }
        deleteBlock(editor, pos)
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
                    // 默认行为会把焦点送回锚点，正文随即失焦；聚焦策略交给调用方决定
                    event.preventDefault()
                    onClosed()
                }}
            >
                <DropdownMenuLabel>{node === null ? '块' : readBlockLabel(node)}</DropdownMenuLabel>
                {isTable ? (
                    <TableBlockMenuItems editor={editor} pos={pos} />
                ) : (
                    <DropdownMenuSub>
                        <DropdownMenuSubTrigger disabled={!isConvertible}>
                            <Type />
                            <span className="flex-1">转换类型</span>
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="w-40">
                            {convertTargets.map((state) => {
                                const Icon = state.target.icon
                                return (
                                    <DropdownMenuItem
                                        key={state.target.id}
                                        disabled={!isConvertible || state.isCurrent}
                                        onSelect={(): void => {
                                            if (pos === null || !ensureEditable(editor)) {
                                                return
                                            }
                                            convertBlock(editor, pos, state.target.id)
                                        }}
                                    >
                                        <Icon />
                                        {state.target.label}
                                    </DropdownMenuItem>
                                )
                            })}
                        </DropdownMenuSubContent>
                    </DropdownMenuSub>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={node === null} onSelect={handleDuplicate}>
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
                <DropdownMenuItem
                    disabled={isBlank}
                    onSelect={(): void => {
                        if (isBlank) {
                            return
                        }
                        onAddToChat(text, readBlockIndex(editor, pos))
                    }}
                >
                    <MessageSquarePlus />
                    添加到 AI 对话
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" disabled={node === null} onSelect={handleDelete}>
                    <Trash2 />
                    删除
                    <DropdownMenuShortcut>{SHORTCUT_DELETE}</DropdownMenuShortcut>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
