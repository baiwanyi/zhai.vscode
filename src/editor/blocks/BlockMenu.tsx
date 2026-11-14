/**
 * 块把手菜单：块类型标签、转换类型子菜单（表格块换成表格结构操作子菜单），
 * 以及复制 / 询问 AI / 加入对话 / 删除四项块级操作。
 * 复用约定：菜单结构取 @components/ui/dropdown-menu，块级命令委托 ./blockCommands，
 * 表格结构命令与光标定位复用 ./tableActions；复制走 @shared/utils/clipboard，
 * 操作结果用 sonner 提示（编辑器入口统一挂 Toaster）；加入对话只把块文本交给宿主，
 * 引用定位、去重与写入都在宿主侧完成。
 * 关键约束：pos 由把手在打开瞬间冻结后传入，菜单内不再读选区，避免鼠标离开块时目标漂移；
 * 触发按钮不在这里渲染——Radix 的 Trigger 会在 pointerdown 上 preventDefault，把原生 dragstart 压掉，
 * 按住拖动就失效了；这里只放一个与按钮等尺寸的透明锚点负责定位，开合由把手的按钮自己控制；
 * 表格结构命令只作用于光标所在行列，执行前必须先把光标落进目标表格，否则会改到另一张表；
 * 表格块没有可转换的类型，子菜单原位交给表格操作；删除项在表格块上直接删表，
 * 但整篇只剩这一张表时仍需保留一个空段落，否则事务会被 schema 拒绝；
 * 删除项直接用 MenuItem 的 destructive variant——Content 上带 !important 的后代规则本会把红色压成普通文字色，
 * 这层压制已由 globals.css 末尾的 utilities 覆盖段统一还原，这里不再叠加颜色类；
 * 快捷键文字只做视觉对齐、没有注册全局键位，Backspace 按下仍由编辑器原生处理；
 * 关闭时阻止 Radix 把焦点还给锚点并主动聚焦正文，否则点完菜单光标就消失。
 */
import {
    ArrowDownToLine,
    ArrowLeftToLine,
    ArrowRightToLine,
    ArrowUpToLine,
    Columns3,
    Copy,
    CopyPlus,
    MessageSquarePlus,
    Rows3,
    Sparkles,
    Table,
    TableProperties,
    Trash2,
    Type,
} from 'lucide-react'
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
    readBlockIndex,
    readBlockLabel,
    readBlockNode,
    readBlockText,
} from './blockCommands'
import { focusTable } from './tableActions'
import type { Editor } from '@tiptap/core'
import type { LucideIcon } from 'lucide-react'
import type { JSX } from 'react'

/** 删除项的快捷键提示：仅展示，不注册键位（见文件头约束） */
const SHORTCUT_DELETE = 'Backspace'

/** 表格块的类型名：命中时子菜单换成表格结构操作，删除项改走删表 */
const TABLE_NODE = 'table'

/** 表格结构操作：每一项都直接作用于表格内的当前光标行列，执行前由 focusTableBlock 落位 */
const TABLE_ACTIONS: ReadonlyArray<{ label: string; icon: LucideIcon; run: (editor: Editor) => void }> = [
    { label: '上方插入行', icon: ArrowUpToLine, run: (editor) => editor.chain().focus().addRowBefore().run() },
    { label: '下方插入行', icon: ArrowDownToLine, run: (editor) => editor.chain().focus().addRowAfter().run() },
    { label: '左侧插入列', icon: ArrowLeftToLine, run: (editor) => editor.chain().focus().addColumnBefore().run() },
    { label: '右侧插入列', icon: ArrowRightToLine, run: (editor) => editor.chain().focus().addColumnAfter().run() },
    { label: '删除当前行', icon: Rows3, run: (editor) => editor.chain().focus().deleteRow().run() },
    { label: '删除当前列', icon: Columns3, run: (editor) => editor.chain().focus().deleteColumn().run() },
    { label: '切换表头行', icon: TableProperties, run: (editor) => editor.chain().focus().toggleHeaderRow().run() },
]

/**
 * 把光标落进目标顶层表格：块菜单的目标块由悬停冻结，光标可能停在别的块上，
 * 表格结构命令必须先生效于用户看着的那张表。找不到表格 DOM 时直接放弃，不猜位置。
 */
function focusTableBlock(editor: Editor, pos: number): boolean {
    if (editor.isDestroyed) {
        return false
    }
    const dom = editor.view.nodeDOM(pos)
    const host = dom instanceof HTMLElement ? dom : null
    const table = host instanceof HTMLTableElement ? host : (host?.querySelector('table') ?? null)
    return table instanceof HTMLTableElement && focusTable(editor, table)
}

export interface BlockMenuProps {
    editor: Editor
    /** 目标块起始位置：菜单打开瞬间冻结，为 null 时全部条目置灰 */
    pos: number | null
    isOpen: boolean
    onOpenChange: (isOpen: boolean) => void
    /** 询问 AI：把块文本交给编辑器现有的查询弹窗 */
    onAskAi: (quote: string) => void
    /** 加入 AI 对话：块文本 + 顶层序号交给宿主，换算成行范围后成为对话的上下文引用 */
    onAddToChat: (quote: string, blockIndex: number) => void
}

export function BlockMenu({ editor, pos, isOpen, onOpenChange, onAskAi, onAddToChat }: BlockMenuProps): JSX.Element {
    const node = pos === null ? null : readBlockNode(editor, pos)
    const text = node === null ? '' : readBlockText(node)
    const isConvertible = node !== null && canConvertBlock(node)
    const isTable = node !== null && node.type.name === TABLE_NODE
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

    /** 表格结构命令：先把光标落进目标表格，命令才会作用在用户看着的那张表上 */
    const runTableAction = (targetPos: number, run: (target: Editor) => void): void => {
        if (!focusTableBlock(editor, targetPos)) {
            return
        }
        run(editor)
    }

    /** 删除块：表格块直接删表，其余块交给 deleteBlock */
    const handleDelete = (): void => {
        if (pos === null) {
            return
        }
        // 整篇只剩这一张表时不能删表：空文档会被 schema 拒绝，退回 deleteBlock 换成空段落
        if (isTable && editor.state.doc.childCount > 1) {
            runTableAction(pos, (target): void => {
                target.chain().focus().deleteTable().run()
            })
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
                    // 默认行为会把焦点送回锚点，正文随即失焦；这里改由编辑器接管
                    event.preventDefault()
                    editor.chain().focus().run()
                }}
            >
                <DropdownMenuLabel>{node === null ? '块' : readBlockLabel(node)}</DropdownMenuLabel>
                {isTable ? (
                    <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                            <Table />
                            <span className="flex-1">表格操作</span>
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="w-40">
                            {TABLE_ACTIONS.map((action) => {
                                const Icon = action.icon
                                return (
                                    <DropdownMenuItem
                                        key={action.label}
                                        disabled={pos === null}
                                        onSelect={(): void => {
                                            if (pos === null) {
                                                return
                                            }
                                            runTableAction(pos, action.run)
                                        }}
                                    >
                                        <Icon />
                                        {action.label}
                                    </DropdownMenuItem>
                                )
                            })}
                        </DropdownMenuSubContent>
                    </DropdownMenuSub>
                ) : (
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
                )}
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
