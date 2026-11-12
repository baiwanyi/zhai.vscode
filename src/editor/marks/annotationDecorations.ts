/**
 * 划线装饰：按标注记录在视图层叠加半透明底色，不进入文档模型。
 * 复用约定：装饰由 ProseMirror 插件持有，标注变化时通过事务 meta 整体替换；
 * 文档编辑时用 mapping 跟随，避免每次输入都重建全量装饰。
 * 关键约束：用 Decoration.inline 而不是 Mark——Mark 会被 getHTML 序列化进 Markdown，
 * 往返时还得额外剥离；装饰只存在于视图层，天然不污染正文。
 * 只定位顶层文本块（段落 / 标题 / 代码块），列表与引用内的嵌套段落暂不处理。
 */
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { AnnotationRecord, HighlightColor } from '@shared/types/editor'
import type { EditorState } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/react'

/** 装饰插件键：事务 meta 与状态读取共用 */
export const annotationPluginKey = new PluginKey<DecorationSet>('zhai-annotation-decorations')

/** 半透明底色：深浅主题下都可读，且不改变文字颜色 */
const HIGHLIGHT_STYLES: Readonly<Record<HighlightColor, string>> = {
    coral: 'background-color: rgba(255, 138, 128, 0.32); border-radius: 2px;',
    violet: 'background-color: rgba(186, 140, 255, 0.32); border-radius: 2px;',
    blue: 'background-color: rgba(120, 170, 255, 0.32); border-radius: 2px;',
    emerald: 'background-color: rgba(110, 220, 170, 0.32); border-radius: 2px;',
    amber: 'background-color: rgba(255, 205, 120, 0.42); border-radius: 2px;',
}

/** 装饰插件：初始为空，收到 meta 整体替换，否则按编辑映射跟随 */
export function createAnnotationPlugin(): Plugin<DecorationSet> {
    return new Plugin<DecorationSet>({
        key: annotationPluginKey,
        state: {
            init: (): DecorationSet => DecorationSet.empty,
            apply: (transaction, previous): DecorationSet => {
                const next: unknown = transaction.getMeta(annotationPluginKey)
                if (next instanceof DecorationSet) {
                    return next
                }
                return previous.map(transaction.mapping, transaction.doc)
            },
        },
        props: {
            decorations: (state: EditorState): DecorationSet =>
                annotationPluginKey.getState(state) ?? DecorationSet.empty,
        },
    })
}

/**
 * 按标注重建装饰：只处理非失效的划线，按 blockIndex 定位顶层块，再在块文本内用 quote 定位。
 * 用 quote 而不是字符偏移定位——Markdown 源码偏移与 ProseMirror 位置口径不同（标记占位、换行折叠），
 * 直接用偏移会错位；quote 是纯文本，块内匹配更可靠。
 */
export function applyAnnotationDecorations(editor: Editor, items: readonly AnnotationRecord[]): void {
    const decorations: Decoration[] = []
    editor.state.doc.content.forEach((node, offset, index) => {
        if (!node.isTextblock) {
            return
        }
        const text = node.textContent
        for (const item of items) {
            if (item.blockIndex !== index || item.orphaned || item.kind !== 'highlight' || item.color === null) {
                continue
            }
            if (item.quote.length === 0) {
                continue
            }
            const localStart = text.indexOf(item.quote)
            if (localStart < 0) {
                continue
            }
            const from = offset + 1 + localStart
            decorations.push(Decoration.inline(from, from + item.quote.length, { style: HIGHLIGHT_STYLES[item.color] }))
        }
    })
    const set = DecorationSet.create(editor.state.doc, decorations)
    const transaction = editor.state.tr.setMeta(annotationPluginKey, set).setMeta('addToHistory', false)
    editor.view.dispatch(transaction)
}
