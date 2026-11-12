/**
 * 表格浮动操作：光标进表格后，在表格底部与右侧各给一个加号（末尾追加一行 / 一列），
 * 右上角给省略号菜单，提供上下插行、左右插列、删除行列与删表。
 * 复用约定：命令全部走 editor.chain()，菜单用 shadcn DropdownMenu，按钮用 @webview/components/Button。
 * 关键约束：表格命令只作用于光标所在的行列，末尾追加必须按节点尺寸算出最后一个单元格的位置；
 * 定位取表格 DOM 相对编辑区页面容器的矩形，容器必须是 position: relative 的 .zhai-editor-page；
 * 只读态与光标不在表格内时不渲染，避免给出无效操作。
 */
import { Ellipsis, Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { Button } from '@webview/components/Button'
import { appendTableColumn, appendTableRow } from './tableActions'
import type { Editor } from '@tiptap/core'
import type { JSX, RefObject } from 'react'

export interface TableToolsProps {
    editor: Editor
    /** 定位基准：编辑区页面容器（position: relative） */
    containerRef: RefObject<HTMLDivElement | null>
}

/** 表格在页面容器内的矩形：所有按钮都按它摆放 */
interface TableFrame {
    top: number
    left: number
    width: number
    height: number
}

/** 表格结构操作：菜单里的每一项都直接作用于当前光标所在的行列 */
const TABLE_ACTIONS: ReadonlyArray<{ label: string; run: (editor: Editor) => void }> = [
    { label: '上方插入行', run: (editor) => editor.chain().focus().addRowBefore().run() },
    { label: '下方插入行', run: (editor) => editor.chain().focus().addRowAfter().run() },
    { label: '左侧插入列', run: (editor) => editor.chain().focus().addColumnBefore().run() },
    { label: '右侧插入列', run: (editor) => editor.chain().focus().addColumnAfter().run() },
    { label: '删除当前行', run: (editor) => editor.chain().focus().deleteRow().run() },
    { label: '删除当前列', run: (editor) => editor.chain().focus().deleteColumn().run() },
    { label: '切换表头行', run: (editor) => editor.chain().focus().toggleHeaderRow().run() },
]

/** 光标所在表格的 DOM：用于取矩形，找不到说明光标不在表格里 */
function findActiveTable(editor: Editor): HTMLTableElement | null {
    if (!editor.isActive('table')) {
        return null
    }
    const { node } = editor.view.domAtPos(editor.state.selection.from)
    const element = node instanceof Element ? node : node.parentElement
    const table = element?.closest('table')
    return table instanceof HTMLTableElement ? table : null
}

export function TableTools({ editor, containerRef }: TableToolsProps): JSX.Element | null {
    const [frame, setFrame] = useState<TableFrame | null>(null)

    const update = useCallback((): void => {
        const container = containerRef.current
        const table = container === null || editor.isDestroyed || !editor.isEditable ? null : findActiveTable(editor)
        if (container === null || table === null) {
            setFrame((previous) => (previous === null ? previous : null))
            return
        }
        const box = table.getBoundingClientRect()
        const origin = container.getBoundingClientRect()
        const next: TableFrame = {
            top: box.top - origin.top,
            left: box.left - origin.left,
            width: box.width,
            height: box.height,
        }
        setFrame((previous) =>
            previous !== null &&
            previous.top === next.top &&
            previous.left === next.left &&
            previous.width === next.width &&
            previous.height === next.height
                ? previous
                : next,
        )
    }, [containerRef, editor])

    useEffect(() => {
        update()
        editor.on('transaction', update)
        // 滚动与窗口尺寸变化都会让旧矩形失效，按钮必须跟着表格走
        const scrollHost = containerRef.current?.parentElement ?? null
        scrollHost?.addEventListener('scroll', update, { passive: true })
        window.addEventListener('resize', update)
        return (): void => {
            editor.off('transaction', update)
            scrollHost?.removeEventListener('scroll', update)
            window.removeEventListener('resize', update)
        }
    }, [containerRef, editor, update])

    if (frame === null) {
        return null
    }

    return (
        <>
            {/* 底部加行：贴在表格下沿，横向居中 */}
            <Button
                variant="ghost"
                size="icon-xs"
                tooltip="添加行"
                className="absolute h-5 w-10 rounded-b-md border border-t-0 bg-muted text-muted-foreground shadow-none hover:bg-accent"
                style={{ top: frame.top + frame.height - 1, left: frame.left + frame.width / 2 - 20 }}
                onClick={(): void => {
                    appendTableRow(editor)
                }}
            >
                <Plus className="size-3.5" />
            </Button>
            {/* 右侧加列：贴在表格右沿，纵向居中 */}
            <Button
                variant="ghost"
                size="icon-xs"
                tooltip="添加列"
                tooltipSide="right"
                className="absolute h-10 w-5 rounded-r-md border border-l-0 bg-muted text-muted-foreground shadow-none hover:bg-accent"
                style={{ top: frame.top + frame.height / 2 - 20, left: frame.left + frame.width - 1 }}
                onClick={(): void => {
                    appendTableColumn(editor)
                }}
            >
                <Plus className="size-3.5" />
            </Button>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        tooltip="表格操作"
                        className="absolute text-muted-foreground"
                        style={{ top: frame.top - 28, left: frame.left + frame.width - 32 }}
                    >
                        <Ellipsis className="size-4" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
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
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                        onSelect={(): void => {
                            editor.chain().focus().deleteTable().run()
                        }}
                    >
                        删除表格
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </>
    )
}
