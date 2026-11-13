/**
 * 表格定位与追加操作：找出光标所在的表格与单元格、把光标落进指定表格，并在表格末尾补一行或一列。
 * 复用约定：命令统一走 editor.chain()，位置由文档结构算出，不读 DOM 的单元格索引；
 * 表格与单元格 DOM 一律按选区位置向上取 closest('table' / 'td, th')，不做行列号换算。
 * 关键约束：表格命令只作用于光标所在的行列，指针悬停触发的操作必须先把光标落进目标表格，
 * 否则命令会作用到另一张表；位置按节点 nodeSize 累加，不能假设单元格宽度一致；
 * 单元格内容起点不在 inline content 内时，必须用 TextSelection.near 贴到最近的文本位置。
 */
import { TextSelection } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/core'

/** 光标所在表格的 DOM：返回 null 表示光标不在表格里 */
export function findActiveTable(editor: Editor): HTMLTableElement | null {
    if (editor.isDestroyed || !editor.isActive('table')) {
        return null
    }
    const { node } = editor.view.domAtPos(editor.state.selection.from)
    const element = node instanceof Element ? node : node.parentElement
    const table = element?.closest('table')
    return table instanceof HTMLTableElement ? table : null
}

/** 光标所在单元格的 DOM：与 findActiveTable 同源，供「是否在末行 / 末列」判断 */
export function findCursorCell(editor: Editor): HTMLTableCellElement | null {
    if (editor.isDestroyed || !editor.isActive('table')) {
        return null
    }
    const { node } = editor.view.domAtPos(editor.state.selection.from)
    const element = node instanceof Element ? node : node.parentElement
    const cell = element?.closest('td, th')
    return cell instanceof HTMLTableCellElement ? cell : null
}

/**
 * 把光标落进指定表格：已经在该表内时保持当前单元格不动，否则贴到最近的文本位置。
 * 悬停触发的操作靠它把「目标表格」翻译成「光标所在表格」，命令才作用在用户看着的那张表上。
 */
export function focusTable(editor: Editor, table: HTMLTableElement): boolean {
    if (editor.isDestroyed || !editor.isEditable) {
        return false
    }
    if (findActiveTable(editor) === table) {
        return true
    }
    let pos: number
    try {
        pos = editor.view.posAtDOM(table, 0)
    } catch {
        // 表格已从文档中移除（悬停后又被删除等）：不猜位置，直接放弃
        return false
    }
    const selection = TextSelection.near(editor.state.doc.resolve(pos))
    return editor.chain().focus().setTextSelection(selection.from).run()
}

/** 最后一个单元格的位置：先按行累加，再在最后一行里按单元格累加 */
export function findLastCellPos(editor: Editor): number | null {
    const { $from } = editor.state.selection
    for (let depth = $from.depth; depth > 0; depth -= 1) {
        const node = $from.node(depth)
        if (node.type.name !== 'table') {
            continue
        }
        let rowPos = $from.before(depth) + 1
        for (let index = 0; index < node.childCount - 1; index += 1) {
            rowPos += node.child(index).nodeSize
        }
        const lastRow = node.child(node.childCount - 1)
        let cellPos = rowPos + 1
        for (let index = 0; index < lastRow.childCount - 1; index += 1) {
            cellPos += lastRow.child(index).nodeSize
        }
        return cellPos
    }
    return null
}

/** 把光标贴到最后一个单元格内：返回是否定位成功 */
function focusLastCell(editor: Editor): boolean {
    const pos = findLastCellPos(editor)
    if (pos === null) {
        return false
    }
    const selection = TextSelection.near(editor.state.doc.resolve(pos))
    return editor.chain().focus().setTextSelection(selection.from).run()
}

/**
 * 目标表格：显式传入时先把光标落进它（悬停触发、光标可能不在该表内），
 * 省略时沿用光标所在表格（键盘与内部调用）。
 */
function resolveTargetTable(editor: Editor, table?: HTMLTableElement): boolean {
    return table === undefined || focusTable(editor, table)
}

/** 末尾追加一行：先定位到目标表格，再落到最后一个单元格执行命令 */
export function appendTableRow(editor: Editor, table?: HTMLTableElement): void {
    if (!resolveTargetTable(editor, table) || !focusLastCell(editor)) {
        return
    }
    editor.chain().focus().addRowAfter().run()
}

/** 末尾追加一列：先定位到目标表格，再落到最后一个单元格执行命令 */
export function appendTableColumn(editor: Editor, table?: HTMLTableElement): void {
    if (!resolveTargetTable(editor, table) || !focusLastCell(editor)) {
        return
    }
    editor.chain().focus().addColumnAfter().run()
}
