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
 * 段末批注图标：纯 DOM 元素，点击由外层事件委托处理（widget 不持有 React 状态）。
 * 用内联 SVG 而非 emoji，避免不同字体下的尺寸与基线漂移。
 */
function createAnnotationMarker(blockIndex: number, count: number): HTMLElement {
    const marker = document.createElement('button')
    marker.type = 'button'
    marker.className = 'zhai-annotation-marker'
    // 样式就地内联：widget 由 ProseMirror 直接插 DOM，不在 React 树里，Tailwind 类不会进产物
    marker.style.cssText =
        'display:inline-flex;align-items:center;gap:2px;margin-left:6px;padding:0 2px;border:0;background:transparent;' +
        'color:var(--vscode-editorInfo-foreground,#3794ff);opacity:.75;cursor:pointer;vertical-align:baseline;font-size:10px;'
    marker.dataset.annotationBlock = String(blockIndex)
    marker.setAttribute('aria-label', `第 ${String(blockIndex + 1)} 段有 ${String(count)} 条批注`)
    marker.innerHTML =
        '<svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor" aria-hidden="true">' +
        '<path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v6a1.5 1.5 0 0 1-1.5 1.5H8.2L5 14v-3H3.5A1.5 1.5 0 0 1 2 9.5z"/>' +
        '</svg>'
    if (count > 1) {
        const badge = document.createElement('span')
        badge.textContent = String(count)
        marker.append(badge)
    }
    return marker
}

/**
 * 按标注重建装饰：划线用 inline 装饰，批注用段末 widget；orphaned 的条目不渲染。
 * 定位用 quote 而不是字符偏移——Markdown 源码偏移与 ProseMirror 位置口径不同（标记占位、换行折叠），
 * 直接用偏移会错位；quote 是纯文本，块内匹配更可靠。
 */
export function applyAnnotationDecorations(editor: Editor, items: readonly AnnotationRecord[]): void {
    const decorations: Decoration[] = []
    const notesByBlock = new Map<number, number>()
    for (const item of items) {
        if (item.kind === 'note' && !item.orphaned) {
            notesByBlock.set(item.blockIndex, (notesByBlock.get(item.blockIndex) ?? 0) + 1)
        }
    }
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
        const noteCount = notesByBlock.get(index)
        if (noteCount !== undefined && noteCount > 0) {
            const endPos = offset + node.nodeSize - 1
            decorations.push(
                Decoration.widget(endPos, createAnnotationMarker(index, noteCount), {
                    side: 1,
                    key: `zhai-note-${String(index)}`,
                }),
            )
        }
    })
    const set = DecorationSet.create(editor.state.doc, decorations)
    const transaction = editor.state.tr.setMeta(annotationPluginKey, set).setMeta('addToHistory', false)
    editor.view.dispatch(transaction)
}
