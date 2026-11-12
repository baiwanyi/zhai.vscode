/**
 * 查找高亮：把命中区间渲染成 inline 装饰，全部命中用淡色、当前项用强调色。
 * 复用约定：与划线装饰同一套思路（Decoration 而非 Mark，只在视图层、不进文档），
 * 因此查找高亮永远不会被写进 Markdown，也不需要清理。
 * 关键约束：样式必须内联——装饰的 class 同样由 ProseMirror 直接写 DOM，Tailwind 类不会进产物；
 * 事务一律 setMeta('addToHistory', false)，查找不能污染撤销栈。
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { Editor } from '@tiptap/react'

/** 命中区间的视图坐标 */
export interface SearchMatch {
    from: number
    to: number
}

/** 一次查找的结果：全部命中 + 当前项下标 */
export interface SearchPayload {
    matches: readonly SearchMatch[]
    activeIndex: number
}

export const searchPluginKey = new PluginKey<DecorationSet>('zhaiSearch')

/** 普通命中：淡黄底；当前项：深黄底 + 描边，滚动到可见时一眼能认出 */
const MATCH_STYLE = 'background-color:rgba(255,214,10,0.28);border-radius:2px;'
const ACTIVE_STYLE =
    'background-color:rgba(255,196,0,0.62);border-radius:2px;box-shadow:0 0 0 1px rgba(255,170,0,0.85);'

function buildDecorations(doc: ProseMirrorNode, payload: SearchPayload): DecorationSet {
    const decorations = payload.matches.map((match, index) =>
        Decoration.inline(match.from, match.to, {
            style: index === payload.activeIndex ? ACTIVE_STYLE : MATCH_STYLE,
        }),
    )
    return DecorationSet.create(doc, decorations)
}

const searchPlugin = new Plugin<DecorationSet>({
    key: searchPluginKey,
    state: {
        init: (): DecorationSet => DecorationSet.empty,
        apply(transaction, previous): DecorationSet {
            const payload: unknown = transaction.getMeta(searchPluginKey)
            if (typeof payload === 'object' && payload !== null) {
                return buildDecorations(transaction.doc, payload as SearchPayload)
            }
            // 文档被编辑时按 mapping 跟随，避免旧高亮错位
            return previous.map(transaction.mapping, transaction.doc)
        },
    },
    props: {
        decorations(state): DecorationSet {
            return searchPluginKey.getState(state) ?? DecorationSet.empty
        },
    },
})

export const SearchExtension = Extension.create({
    name: 'zhaiSearch',
    addProseMirrorPlugins() {
        return [searchPlugin]
    },
})

/** 把一次查找结果投到编辑器：不写入历史，也不触发内容变更回调 */
export function applySearchDecorations(editor: Editor, payload: SearchPayload): void {
    const transaction = editor.state.tr.setMeta(searchPluginKey, payload).setMeta('addToHistory', false)
    editor.view.dispatch(transaction)
}

/** 清空高亮：关闭查找面板时调用，避免残留黄色底纹 */
export function clearSearchDecorations(editor: Editor): void {
    applySearchDecorations(editor, { matches: [], activeIndex: -1 })
}
