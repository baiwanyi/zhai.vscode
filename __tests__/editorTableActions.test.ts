// @vitest-environment jsdom
import { Editor } from '@tiptap/core'
import { TableKit } from '@tiptap/extension-table'
import { TextSelection } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import { describe, expect, it } from 'vitest'
import { appendTableColumn, appendTableRow } from '@webview/editor/blocks/tableActions'
import { CursorLineExtension } from '@webview/editor/marks/cursorLineExtension'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

/**
 * 表格末尾追加：验证加号按钮背后的位置计算真的落在最后一行 / 最后一列。
 * 复用约定：直接调用 tableActions 的命令函数，断言只看文档结构，不依赖 DOM 布局。
 * 关键约束：表格命令只作用于光标所在行列，光标停在首格时追加也必须落在末尾——
 * 因此除行列数外还要断言带标记的末行 / 末列位置没有移动。
 */
function createEditor(): Editor {
    return new Editor({
        extensions: [StarterKit, TableKit.configure({ table: { resizable: false } })],
        content: '<p></p>',
    })
}

function findTable(editor: Editor): ProseMirrorNode | null {
    const tables: ProseMirrorNode[] = []
    editor.state.doc.forEach((node) => {
        if (node.type.name === 'table') {
            tables.push(node)
        }
    })
    return tables[0] ?? null
}

/** 每行的纯文本，用来判断标记内容落在哪一行 */
function rowTexts(editor: Editor): string[] {
    const table = findTable(editor)
    if (table === null) {
        return []
    }
    return table.content.content.map((row) => row.textContent)
}

/** 往表格最后一个单元格写标记：段落位置按 table 内容起点累加，不能取表格外的尾部段落 */
function fillLastCell(editor: Editor, text: string): void {
    const positions: number[] = []
    editor.state.doc.descendants((node, pos) => {
        if (node.type.name !== 'table') {
            return true
        }
        node.descendants((child, childPos) => {
            if (child.type.name === 'paragraph') {
                positions.push(pos + 1 + childPos)
            }
            return true
        })
        return false
    })
    const last = positions[positions.length - 1]
    if (last === undefined) {
        return
    }
    editor
        .chain()
        .setTextSelection(last + 1)
        .insertContent(text)
        .run()
}

/** 光标放回第一个单元格：用来验证「光标在别处时追加仍落在末尾」 */
function focusFirstCell(editor: Editor): void {
    const selection = TextSelection.near(editor.state.doc.resolve(1))
    editor.chain().setTextSelection(selection.from).run()
}

/** 表格的 DOM 节点：悬停触发的追加按它定位表格 */
function findTableElement(editor: Editor): HTMLTableElement | null {
    const element = editor.view.dom.querySelector('table')
    return element instanceof HTMLTableElement ? element : null
}

describe('表格末尾追加', () => {
    it('追加行：行数 +1，标记内容仍在倒数第二行', () => {
        const editor = createEditor()
        editor.commands.insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        fillLastCell(editor, 'Z')
        focusFirstCell(editor)
        appendTableRow(editor)
        const rows = rowTexts(editor)
        expect(rows).toHaveLength(4)
        expect(rows[2]).toBe('Z')
        expect(rows[3]).toBe('')
        editor.destroy()
    })

    it('追加列：列数 +1，标记内容仍在倒数第二列', () => {
        const editor = createEditor()
        editor.commands.insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        fillLastCell(editor, 'Z')
        focusFirstCell(editor)
        appendTableColumn(editor)
        const table = findTable(editor)
        expect(table?.child(0)?.childCount).toBe(4)
        expect(table?.child(2)?.child(2)?.textContent).toBe('Z')
        expect(table?.child(2)?.child(3)?.textContent).toBe('')
        editor.destroy()
    })

    it('连续追加行列不会破坏结构', () => {
        const editor = createEditor()
        editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true })
        appendTableRow(editor)
        appendTableColumn(editor)
        appendTableRow(editor)
        const table = findTable(editor)
        expect(table?.childCount).toBe(4)
        expect(table?.child(0)?.childCount).toBe(3)
        editor.destroy()
    })

    it('光标不在表格内时不动作', () => {
        const editor = createEditor()
        editor.commands.setContent('<p>正文</p>')
        editor.commands.setTextSelection(1)
        appendTableRow(editor)
        appendTableColumn(editor)
        expect(findTable(editor)).toBeNull()
        editor.destroy()
    })

    it('光标在表格外时，按传入的表格 DOM 追加到该表末尾', () => {
        const editor = createEditor()
        editor.commands.setContent(
            '<p>正文</p><table><tbody><tr><th><p>H</p></th></tr><tr><td><p>Z</p></td></tr></tbody></table>',
        )
        // 光标留在正文段落里：悬停触发的追加必须靠自己把光标落进目标表格
        editor.commands.setTextSelection(2)
        const table = findTableElement(editor)
        expect(table).not.toBeNull()
        if (table === null) {
            return
        }
        appendTableRow(editor, table)
        const rows = rowTexts(editor)
        expect(rows).toHaveLength(3)
        expect(rows[1]).toBe('Z')
        editor.destroy()
    })
})

describe('当前单元格标记', () => {
    it('光标所在单元格挂上 is-cursor-cell，且只标记一格', () => {
        const editor = new Editor({
            extensions: [StarterKit, TableKit.configure({ table: { resizable: false } }), CursorLineExtension],
            content: '<p></p>',
        })
        editor.commands.insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        const cells = Array.from(editor.view.dom.querySelectorAll('td, th'))
        const marked = cells.filter((cell) => cell.classList.contains('is-cursor-cell'))
        expect(marked).toHaveLength(1)
        editor.destroy()
    })
})
