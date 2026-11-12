/**
 * 当前行标记：给光标所在的顶层块加一个 class，供 editor.css 高亮左侧行号。
 * 复用约定：用 Decoration.node 走视图层，和划线装饰同一套思路——只影响 DOM，不写进文档。
 * 关键约束：行号按顶层块计数，标记必须落在 depth 1 的节点上，段落内部的装饰不会命中；
 * 选区塌陷到文档边界（NodeSelection）时改用 nodeAfter，否则整行高亮会凭空消失。
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/** 光标所在块的 class，与 editor.css 的行号高亮规则对应 */
const CURSOR_LINE_CLASS = 'is-cursor-line'

const cursorLinePlugin = new Plugin({
    key: new PluginKey('zhaiCursorLine'),
    props: {
        decorations(state): DecorationSet {
            const { $from } = state.selection
            // 光标在块内取顶层节点；落在节点边界时退到后面的那个块
            const node = $from.depth >= 1 ? $from.node(1) : $from.nodeAfter
            const pos = $from.depth >= 1 ? $from.before(1) : $from.pos
            if (node === null || node === undefined || !node.isBlock) {
                return DecorationSet.empty
            }
            return DecorationSet.create(state.doc, [
                Decoration.node(pos, pos + node.nodeSize, { class: CURSOR_LINE_CLASS }),
            ])
        },
    },
})

export const CursorLineExtension = Extension.create({
    name: 'zhaiCursorLine',

    addProseMirrorPlugins(): Plugin[] {
        return [cursorLinePlugin]
    },
})
