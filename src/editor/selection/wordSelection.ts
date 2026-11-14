/**
 * 双击选词：按 Intl.Segmenter 的词边界选中命中片段，解决中文无空白时双击扩成整段。
 * 复用约定：纯 ProseMirror 工具，只读 view.state，不发请求、不碰 React 状态。
 * 关键约束：块内文本偏移必须按 inline 子节点累加——硬换行等 leaf 占文档位置却不进 textContent，
 * 直接用「位置差」当文本索引会让含软换行的段落选词整体后移；
 * 命中区间左闭右开并跳过 isWordLike === false 的段，双击空白回落到编辑器默认行为；
 * 运行环境缺 Intl.Segmenter 时返回 false，由 ProseMirror 走默认处理。
 */
import { TextSelection } from '@tiptap/pm/state'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'

/** 块内文本偏移：按子节点累加文本长度，非文本子节点只扣位置不计数 */
export function textOffsetAt(node: ProseMirrorNode, localPos: number): number {
    let textOffset = 0
    let remaining = localPos
    for (let index = 0; index < node.childCount && remaining > 0; index += 1) {
        const child = node.child(index)
        if (child.isText) {
            const consumed = Math.min(child.nodeSize, remaining)
            textOffset += consumed
            remaining -= consumed
            continue
        }
        remaining -= child.nodeSize
    }
    return textOffset
}

/** 按词边界选中 pos 所在片段，返回是否接管了这次双击 */
export function selectWordAt(view: EditorView, pos: number): boolean {
    if (typeof Intl.Segmenter !== 'function') {
        return false
    }
    const $pos = view.state.doc.resolve(pos)
    if (!$pos.parent.inlineContent) {
        return false
    }
    const blockStart = $pos.start()
    const text = $pos.parent.textContent
    const offset = textOffsetAt($pos.parent, pos - blockStart)
    const segmenter = new Intl.Segmenter('zh', { granularity: 'word' })
    for (const item of segmenter.segment(text)) {
        if (item.isWordLike === false || offset < item.index || offset >= item.index + item.segment.length) {
            continue
        }
        const from = blockStart + item.index
        const to = from + item.segment.length
        if (from >= to) {
            continue
        }
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)))
        return true
    }
    return false
}
