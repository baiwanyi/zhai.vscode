/**
 * 光标位置标记：给光标所在的顶层块加 is-cursor-line（高亮左侧行号），
 * 给光标所在的表格单元格加 is-cursor-cell（高亮当前格）。
 * 复用约定：用 Decoration.node 走视图层，和划线装饰同一套思路——只影响 DOM，不写进文档。
 * 关键约束：行号按顶层块计数，标记必须落在 depth 1 的节点上，段落内部的装饰不会命中；
 * 单元格标记只在光标位于表内时产出，必须向上找到 tableCell / tableHeader 那一层，
 * 否则装饰会落在段落上、命不中编辑器样式里的单元格规则；
 * 选区塌陷到文档边界（NodeSelection）时改用 nodeAfter，否则整行高亮会凭空消失。
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { EditorState } from '@tiptap/pm/state'

/** 光标所在块的 class，与 editor.css 的行号高亮规则对应 */
const CURSOR_LINE_CLASS = 'is-cursor-line'

/** 光标所在单元格的 class，与 editor.css 的当前格底色规则对应 */
const CURSOR_CELL_CLASS = 'is-cursor-cell'

/** 光标所在的表格单元格：向上找到 tableCell / tableHeader 那一层，返回位置与节点 */
function findCursorCell(state: EditorState): { pos: number; node: ProseMirrorNode } | null {
    const { $from } = state.selection
    for (let depth = $from.depth; depth > 0; depth -= 1) {
        const node = $from.node(depth)
        if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
            return { pos: $from.before(depth), node }
        }
    }
    return null
}

const cursorLinePlugin = new Plugin({
    key: new PluginKey('zhaiCursorLine'),
    props: {
        decorations(state): DecorationSet {
            const decorations: Decoration[] = []
            const { $from } = state.selection
            // 光标在块内取顶层节点；落在节点边界时退到后面的那个块
            const node = $from.depth >= 1 ? $from.node(1) : $from.nodeAfter
            const pos = $from.depth >= 1 ? $from.before(1) : $from.pos
            if (node !== null && node !== undefined && node.isBlock) {
                decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: CURSOR_LINE_CLASS }))
            }
            // 光标在表格里时再补一条单元格标记：宽表里靠底色就能定位正在编辑的那一格
            const cell = findCursorCell(state)
            if (cell !== null) {
                decorations.push(Decoration.node(cell.pos, cell.pos + cell.node.nodeSize, { class: CURSOR_CELL_CLASS }))
            }
            return decorations.length === 0 ? DecorationSet.empty : DecorationSet.create(state.doc, decorations)
        },
    },
})

export const CursorLineExtension = Extension.create({
    name: 'zhaiCursorLine',

    addProseMirrorPlugins(): Plugin[] {
        return [cursorLinePlugin]
    },
})
