/**
 * 表格浮动操作：指针悬停表格（或光标进入表格）时给出浮动按钮——
 * 表格最底部一行出现「添加行」，最右边一列出现「添加列」，右上角常驻省略号菜单，提供插行插列、删除行列与删表。
 * 复用约定：结构命令走 tableActions，菜单用 shadcn DropdownMenu，按钮用 @webview/components/Button。
 * 关键约束：加行 / 加列的可见条件是「悬停或光标所在的单元格位于末行 / 末列」，不只是指针在表格里；
 * 悬停的表格与单元格优先于光标所在表格，执行命令前必须把光标落进该表格，否则命令会作用到另一张表；
 * 指针停在表格边框这类非单元格位置上时保留上一次的单元格，否则从末行滑向加号的途中按钮会闪断；
 * 定位取表格 DOM 相对编辑区页面容器的矩形，容器必须是 position: relative 的 .zhai-editor-page；
 * 菜单打开期间冻结悬停目标（指针此时在 portal 里，页面收不到事件，重算会让按钮来回跳）；
 * 只读态与找不到目标表格时不渲染，避免给出无效操作。
 */
import { Ellipsis, Plus } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@components/ui/dropdown-menu'
import { Button } from '@webview/components/Button'
import { appendTableColumn, appendTableRow, findActiveTable, findCursorCell, focusTable } from './tableActions'
import type { Editor } from '@tiptap/core'
import type { JSX, RefObject } from 'react'

export interface TableToolsProps {
    editor: Editor
    /** 定位基准：编辑区页面容器（position: relative） */
    containerRef: RefObject<HTMLDivElement | null>
}

/** 工具条自身的标记属性：指针从单元格移到加号 / 菜单按钮上时据此保持显示 */
const TOOLS_ATTR = 'data-table-tools'

/**
 * 热区外扩距离：表格与加号之间的缝隙由表格下外边距（1em）加按钮自身的外边距与厚度构成，
 * 这段带子都算作「指针仍在按钮附近」，取 56px 容得下各类字号下的 1em 与按钮尺寸。
 */
const BUTTON_REACH = 56

/** 指针当前指向的表格与单元格：单元格为空表示停在表格边框、行列间隙这类非单元格位置 */
interface TableHover {
    table: HTMLTableElement
    cell: HTMLTableCellElement | null
}

/** 表格在页面容器内的矩形与它对应的 DOM：按钮按矩形摆放，命令以该表为目标，居中单元格决定加行 / 加列是否可见 */
interface TableFrame {
    table: HTMLTableElement
    cell: HTMLTableCellElement | null
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

/** 单元格是否位于表格最后一行：加行按钮只在这一行出现 */
function isLastRowCell(cell: HTMLTableCellElement): boolean {
    const table = cell.closest('table')
    const row = cell.parentElement
    if (!(table instanceof HTMLTableElement) || !(row instanceof HTMLTableRowElement)) {
        return false
    }
    // rows 按文档顺序覆盖 thead / tbody，最后一项就是视觉上的末行
    return table.rows[table.rows.length - 1] === row
}

/** 单元格是否位于表格最后一列：加列按钮只在这一列出现 */
function isLastColumnCell(cell: HTMLTableCellElement): boolean {
    const row = cell.parentElement
    if (!(row instanceof HTMLTableRowElement)) {
        return false
    }
    return row.cells[row.cells.length - 1] === cell
}

export function TableTools({ editor, containerRef }: TableToolsProps): JSX.Element | null {
    // 指针悬停的表格与单元格：优先于光标所在位置，鼠标扫到哪一格，加行 / 加列就按那一格决定是否出现
    const [hover, setHover] = useState<TableHover | null>(null)
    const [frame, setFrame] = useState<TableFrame | null>(null)
    const [isMenuOpen, setIsMenuOpen] = useState(false)
    // 事件监听里要读最新开合状态，走 ref 免得每次开合都重挂监听
    const isMenuOpenRef = useRef(false)
    // 最新一次算出的矩形与单元格：热区判定在事件回调里读，走 ref 才不会拿到过期闭包
    const frameRef = useRef<TableFrame | null>(null)

    useEffect(() => {
        isMenuOpenRef.current = isMenuOpen
    }, [isMenuOpen])

    /**
     * 指针是否还停在「表格 + 两个加号」的联合热区内。
     * 表格自带 1em 下外边距、加号又各带外边距，指针从末行 / 末列滑向按钮时要穿过一段
     * 不属于任何元素的距离；这段距离必须算作可停留区，否则指针一落进去按钮就会被摘掉，
     * 用户根本来不及点（按时间宽限也救不了——指针停在缝隙里不动时计时照样会到期）。
     */
    const isInHotZone = useCallback(
        (event: PointerEvent): boolean => {
            const frame = frameRef.current
            const container = containerRef.current
            if (frame === null || frame.cell === null || container === null) {
                return false
            }
            const origin = container.getBoundingClientRect()
            const x = event.clientX - origin.left
            const y = event.clientY - origin.top
            const right = frame.left + frame.width
            const bottom = frame.top + frame.height
            if (x >= frame.left && x <= right && y >= frame.top && y <= bottom) {
                return true
            }
            // 加行条：表格下沿向下一条带子；加列条：表格右沿向右一条带子
            if (
                isLastRowCell(frame.cell) &&
                x >= frame.left &&
                x <= right &&
                y > bottom &&
                y <= bottom + BUTTON_REACH
            ) {
                return true
            }
            return (
                isLastColumnCell(frame.cell) && y >= frame.top && y <= bottom && x > right && x <= right + BUTTON_REACH
            )
        },
        [containerRef],
    )

    const update = useCallback((): void => {
        const container = containerRef.current
        if (container === null || editor.isDestroyed || !editor.isEditable) {
            frameRef.current = null
            setFrame((previous) => (previous === null ? previous : null))
            return
        }
        // 悬停的表格可能已被删除（撤销、删表），此时退回光标所在表格
        const hovered = hover !== null && hover.table.isConnected ? hover : null
        const table = hovered === null ? findActiveTable(editor) : hovered.table
        if (table === null) {
            frameRef.current = null
            setFrame((previous) => (previous === null ? previous : null))
            return
        }
        const hoverCell = hovered === null ? null : hovered.cell
        const cursorCell = findCursorCell(editor)
        // 悬停的单元格优先；停在边框上时退回光标单元格，但它必须属于当前这张表
        const cell =
            hoverCell !== null && hoverCell.isConnected
                ? hoverCell
                : cursorCell !== null && cursorCell.closest('table') === table
                  ? cursorCell
                  : null
        const box = table.getBoundingClientRect()
        const origin = container.getBoundingClientRect()
        const next: TableFrame = {
            table,
            cell,
            top: box.top - origin.top,
            left: box.left - origin.left,
            width: box.width,
            height: box.height,
        }
        // 热区判定读这份矩形：与 state 同源，指针移动时不必等一次渲染才拿到新值
        frameRef.current = next
        setFrame((previous) =>
            previous !== null &&
            previous.table === next.table &&
            previous.cell === next.cell &&
            previous.top === next.top &&
            previous.left === next.left &&
            previous.width === next.width &&
            previous.height === next.height
                ? previous
                : next,
        )
    }, [containerRef, editor, hover])

    /**
     * 悬停检测：命中表格就记下它所在的单元格；指针落在工具条自身（加号、菜单按钮）上时保持不动。
     * 落在正文其它位置时先看是否还在热区内——表格与加号之间的缝隙不属于任何元素，
     * 那里一清空按钮就在滑向它的途中消失；只有真正离开热区才清空。
     * 菜单打开期间一律跳过——指针此时在 portal 里，页面上残留的移动不该改变目标表格。
     */
    const handlePointerMove = useCallback(
        (event: PointerEvent): void => {
            if (isMenuOpenRef.current) {
                return
            }
            const target = event.target
            const element = target instanceof Element ? target : null
            const table = element === null ? null : element.closest('table')
            if (table instanceof HTMLTableElement) {
                const matched = element?.closest('td, th') ?? null
                const cell = matched instanceof HTMLTableCellElement ? matched : null
                setHover((previous) => {
                    if (previous !== null && previous.table === table) {
                        // 表格内部但没命中单元格（边框、行列间隙）时保留上一次的单元格，
                        // 否则从末行滑向加号按钮的途中按钮会闪断
                        if (cell === null) {
                            return previous
                        }
                        return previous.cell === cell ? previous : { table, cell }
                    }
                    return { table, cell }
                })
                return
            }
            if (element !== null && element.closest(`[${TOOLS_ATTR}]`) !== null) {
                return
            }
            if (isInHotZone(event)) {
                return
            }
            setHover((previous) => (previous === null ? previous : null))
        },
        [isInHotZone],
    )

    /** 指针离开编辑区：清掉悬停目标，退回到光标所在表格与单元格 */
    const handlePointerLeave = useCallback((): void => {
        if (isMenuOpenRef.current) {
            return
        }
        setHover((previous) => (previous === null ? previous : null))
    }, [])

    useEffect(() => {
        update()
        editor.on('transaction', update)
        // 滚动与窗口尺寸变化都会让旧矩形失效，按钮必须跟着表格走
        const container = containerRef.current
        const scrollHost = container?.parentElement ?? null
        scrollHost?.addEventListener('scroll', update, { passive: true })
        window.addEventListener('resize', update)
        container?.addEventListener('pointermove', handlePointerMove)
        container?.addEventListener('pointerleave', handlePointerLeave)
        return (): void => {
            editor.off('transaction', update)
            scrollHost?.removeEventListener('scroll', update)
            window.removeEventListener('resize', update)
            container?.removeEventListener('pointermove', handlePointerMove)
            container?.removeEventListener('pointerleave', handlePointerLeave)
        }
    }, [containerRef, editor, handlePointerLeave, handlePointerMove, update])

    if (frame === null) {
        return null
    }

    // 加行 / 加列只在自己对应的末行 / 末列上出现：中间行列只需省略号菜单，不必常驻两个加号
    const canAddRow = frame.cell !== null && isLastRowCell(frame.cell)
    const canAddColumn = frame.cell !== null && isLastColumnCell(frame.cell)

    /** 菜单开合：关闭时清掉悬停目标，指针此刻停在已消失的菜单上，留着会让按钮停在旧表格 */
    const handleMenuOpenChange = (isOpen: boolean): void => {
        setIsMenuOpen(isOpen)
        if (!isOpen) {
            setHover(null)
        }
    }

    /** 执行结构命令：先把光标落进目标表格，命令才会作用在用户看着的那张表上 */
    const runAction = (run: (target: Editor) => void): void => {
        if (!focusTable(editor, frame.table)) {
            return
        }
        run(editor)
    }

    return (
        <>
            {/* 底部加行：贴在表格下沿，宽度与表格等宽；只有指针或光标落在末行时出现 */}
            {canAddRow ? (
                <Button
                    variant="outline"
                    size="icon-xs"
                    tooltip="添加行"
                    className="absolute h-5 mt-1 border-dashed bg-white/10"
                    style={{ top: frame.top + frame.height - 1, left: frame.left, width: frame.width }}
                    onClick={(): void => {
                        appendTableRow(editor, frame.table)
                    }}
                >
                    <Plus className="size-3.5" />
                </Button>
            ) : null}
            {/* 右侧加列：贴在表格右沿，高度与表格等高；只有指针或光标落在末列时出现 */}
            {canAddColumn ? (
                <Button
                    variant="outline"
                    size="icon-xs"
                    tooltip="添加列"
                    className="absolute w-5 ml-1 border-dashed bg-white/10"
                    style={{ top: frame.top, left: frame.left + frame.width - 1, height: frame.height }}
                    onClick={(): void => {
                        appendTableColumn(editor, frame.table)
                    }}
                >
                    <Plus className="size-3.5" />
                </Button>
            ) : null}
            <DropdownMenu open={isMenuOpen} onOpenChange={handleMenuOpenChange}>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="secondary"
                        size="icon-xs"
                        tooltip="表格操作"
                        className="absolute"
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
                                runAction(action.run)
                            }}
                        >
                            {action.label}
                        </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                        onSelect={(): void => {
                            runAction((target): void => {
                                target.chain().focus().deleteTable().run()
                            })
                        }}
                    >
                        删除表格
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </>
    )
}
