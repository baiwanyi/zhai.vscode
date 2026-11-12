/**
 * 表格追加操作：在表格末尾补一行或一列，供表格浮动按钮复用。
 * 复用约定：命令统一走 editor.chain()，位置由文档结构算出，不读 DOM、不依赖选区落在哪一格。
 * 关键约束：表格命令只作用于光标所在的行列，末尾追加必须先把光标移到最后一个单元格；
 * 位置按节点 nodeSize 累加，不能假设单元格宽度一致；单元格内容起点落在段落之外时
 * 必须用 TextSelection.near 贴到最近的文本位置，直接 setTextSelection 会因不在 inline content 内失败。
 */
import { TextSelection } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/core'

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

/** 末尾追加一行 */
export function appendTableRow(editor: Editor): void {
    if (!editor.isEditable || !focusLastCell(editor)) {
        return
    }
    editor.chain().focus().addRowAfter().run()
}

/** 末尾追加一列 */
export function appendTableColumn(editor: Editor): void {
    if (!editor.isEditable || !focusLastCell(editor)) {
        return
    }
    editor.chain().focus().addColumnAfter().run()
}
