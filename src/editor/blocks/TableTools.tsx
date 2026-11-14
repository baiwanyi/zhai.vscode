/**
 * 表格浮动操作：指针悬停表格（或光标进入表格）时给出两个加号按钮——
 * 表格最底部一行出现「添加行」，最右边一列出现「添加列」。
 * 复用约定：追加命令走 tableActions 的 appendTableRow / appendTableColumn，按钮用 @webview/components/Button。
 * 关键约束：加行 / 加列的可见条件是「悬停或光标所在的单元格位于末行 / 末列」，不只是指针在表格里；
 * 悬停的表格与单元格优先于光标所在表格；
 * 指针停在表格边框这类非单元格位置上时保留上一次的单元格，否则从末行滑向加号的途中按钮会闪断；
 * 定位取表格 DOM 相对编辑区页面容器的矩形，容器必须是 position: relative 的 .zhai-editor-page；
 * 插行插列、删除行列与删表这类结构操作不在本组件内，统一由块把手菜单在表格块上承担；
 * 只读态与找不到目标表格时不渲染，避免给出无效操作。
 */
import { Plus } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@webview/components/Button'
import { appendTableColumn, appendTableRow, findActiveTable, findCursorCell } from './tableActions'
import type { Editor } from '@tiptap/core'
import type { JSX, RefObject } from 'react'

export interface TableToolsProps {
    editor: Editor
    /** 定位基准：编辑区页面容器（position: relative） */
    containerRef: RefObject<HTMLDivElement | null>
}

/** 工具条自身的标记属性：指针从单元格移到加号上时据此保持显示 */
const TOOLS_ATTR = 'data-table-tools'

/** 表格下外边距（em）：与 editor.css 里 table 的 margin 下侧一致，加号正是落在这段边距里 */
const TABLE_MARGIN_EM = 2

/** 加号自身占位：mt-1（4px）+ h-5（20px），加行与加列共用同一套间距 */
const BUTTON_CHROME = 24

/**
 * 热区外扩距离：表格与加号之间的带子由表格下外边距（2em）加按钮自身的外边距与厚度构成，
 * 这段带子都算作「指针仍在按钮附近」，否则指针从末行滑向加号时按钮会被摘掉；
 * 边距必须按字号换算而不是写死像素：字号调大后 2em 会超过固定值，固定值跟不上就会在那段带子里闪断。
 * 横向加列同用这个宽度，多出的余量只会让按钮多留一会儿，不影响点击判定。
 */
function readButtonReach(table: HTMLTableElement): number {
    const fontSize = Number.parseFloat(getComputedStyle(table).fontSize)
    const em = Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 16
    return em * TABLE_MARGIN_EM + BUTTON_CHROME
}

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
    // 指针悬停的表格与单元格：优先于光标所在位置，鼠标扫到哪一格，加行 / 加列就按那一格决定是否出现。
    // 存 ref 而非 state：它不参与渲染，指针回调改完直接重算矩形，监听器才不会随每次跨格反复解绑重绑
    const hoverRef = useRef<TableHover | null>(null)
    const [frame, setFrame] = useState<TableFrame | null>(null)
    // 最新一次算出的矩形与单元格：热区判定在事件回调里读，走 ref 才不会拿到过期闭包
    const frameRef = useRef<TableFrame | null>(null)

    /**
     * 指针是否还停在「表格 + 两个加号」的联合热区内。
     * 表格自带 2em 下外边距、加号就藏在这段边距里，指针从末行 / 末列滑向按钮时要穿过一段
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
            const reach = readButtonReach(frame.table)
            const origin = container.getBoundingClientRect()
            const x = event.clientX - origin.left
            const y = event.clientY - origin.top
            const right = frame.left + frame.width
            const bottom = frame.top + frame.height
            if (x >= frame.left && x <= right && y >= frame.top && y <= bottom) {
                return true
            }
            // 加行条：表格下沿向下一条带子；加列条：表格右沿向右一条带子
            if (isLastRowCell(frame.cell) && x >= frame.left && x <= right && y > bottom && y <= bottom + reach) {
                return true
            }
            return isLastColumnCell(frame.cell) && y >= frame.top && y <= bottom && x > right && x <= right + reach
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
        const hover = hoverRef.current
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
    }, [containerRef, editor])

    /** 清空悬停目标并立即重算：指针离开表格与加号的热区时调用 */
    const clearHover = useCallback((): void => {
        if (hoverRef.current === null) {
            return
        }
        hoverRef.current = null
        update()
    }, [update])

    /**
     * 悬停检测：命中表格就记下它所在的单元格；指针落在工具条自身（加号）上时保持不动。
     * 落在正文其它位置时先看是否还在热区内——表格与加号之间的缝隙不属于任何元素，
     * 那里一清空按钮就在滑向它的途中消失；只有真正离开热区才清空。
     */
    const handlePointerMove = useCallback(
        (event: PointerEvent): void => {
            const target = event.target
            const element = target instanceof Element ? target : null
            const table = element === null ? null : element.closest('table')
            if (table instanceof HTMLTableElement) {
                const matched = element?.closest('td, th') ?? null
                const cell = matched instanceof HTMLTableCellElement ? matched : null
                const previous = hoverRef.current
                if (previous !== null && previous.table === table) {
                    // 表格内部但没命中单元格（边框、行列间隙）时保留上一次的单元格，
                    // 否则从末行滑向加号按钮的途中按钮会闪断
                    if (cell === null || previous.cell === cell) {
                        return
                    }
                }
                hoverRef.current = { table, cell }
                update()
                return
            }
            if (element !== null && element.closest(`[${TOOLS_ATTR}]`) !== null) {
                return
            }
            if (isInHotZone(event)) {
                return
            }
            clearHover()
        },
        [clearHover, isInHotZone, update],
    )

    useEffect(() => {
        update()
        editor.on('transaction', update)
        // 滚动与窗口尺寸变化都会让旧矩形失效，按钮必须跟着表格走
        const container = containerRef.current
        const scrollHost = container?.parentElement ?? null
        scrollHost?.addEventListener('scroll', update, { passive: true })
        window.addEventListener('resize', update)
        container?.addEventListener('pointermove', handlePointerMove)
        container?.addEventListener('pointerleave', clearHover)
        return (): void => {
            editor.off('transaction', update)
            scrollHost?.removeEventListener('scroll', update)
            window.removeEventListener('resize', update)
            container?.removeEventListener('pointermove', handlePointerMove)
            container?.removeEventListener('pointerleave', clearHover)
        }
    }, [clearHover, containerRef, editor, handlePointerMove, update])

    if (frame === null) {
        return null
    }

    // 加行 / 加列只在自己对应的末行 / 末列上出现，避免两个加号常驻打断阅读
    const canAddRow = frame.cell !== null && isLastRowCell(frame.cell)
    const canAddColumn = frame.cell !== null && isLastColumnCell(frame.cell)

    return (
        <>
            {/* 底部加行：贴在表格下沿，宽度与表格等宽；只有指针或光标落在末行时出现 */}
            {canAddRow ? (
                <Button
                    variant="outline"
                    size="icon-xs"
                    tooltip="添加行"
                    data-table-tools=""
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
                    data-table-tools=""
                    className="absolute w-5 ml-1 border-dashed bg-white/10"
                    style={{ top: frame.top, left: frame.left + frame.width - 1, height: frame.height }}
                    onClick={(): void => {
                        appendTableColumn(editor, frame.table)
                    }}
                >
                    <Plus className="size-3.5" />
                </Button>
            ) : null}
        </>
    )
}
