/**
 * 划线装饰：按标注记录在视图层叠加马克笔笔触（铺满字面、两端硬边斜切），不进入文档模型。
 * 复用约定：装饰由 ProseMirror 插件持有，标注变化时通过事务 meta 整体替换；
 * 文档编辑时用 mapping 跟随，避免每次输入都重建全量装饰。
 * 关键约束：用 Decoration.inline 而不是 Mark——Mark 会被 getHTML 序列化进 Markdown，
 * 往返时还得额外剥离；装饰只存在于视图层，天然不污染正文；
 * 装饰只碰背景，不设置任何字体属性，也不用 mask——遮罩会连文字一起裁，看起来就是字变细、变形。
 * 只定位顶层文本块（段落 / 标题 / 代码块），列表与引用内的嵌套段落暂不处理。
 */
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { AnnotationRecord, HighlightColor } from '@shared/types/editor'
import type { EditorState } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/react'

/** 装饰插件键：事务 meta 与状态读取共用 */
export const annotationPluginKey = new PluginKey<DecorationSet>('zhai-annotation-decorations')

/**
 * 马克笔笔触：主体 + 笔锋两层背景拼出「两端斜切」的整笔，端部按固定像素走，不随划线长度缩放。
 * 关键约束：绝不能用 mask——遮罩作用于元素的全部内容，斜切与起伏的边缘会把同一段文字一起裁掉，
 * 看起来就是「划完线字变细、变样」；只有背景层不碰任何排版属性。
 * 也不能让两层硬碰硬：重叠处半透明颜色叠加会变深，不重叠则两条抗锯齿淡边拼成白线。
 * 这里让主体右端最后 5px 淡出、笔锋左端 5px 淡入，交叉过渡的合成浓度与两侧相差不到 2%，
 * 接缝既不是白线也不是深线。
 * 另有一条必须显式声明的：span 会命中 globals 里的 `* { font-light }`，
 * 不写 `font: inherit` 就会把标题、粗体的字重一并压成 300，看起来就是「划线把加粗取消了」。
 * box-decoration-break: clone 保证跨行时每行都独立成套笔触，而不是整段只有首尾两处切口。
 */
function highlightPaint(rgb: string, alpha: number): string {
    const solid = `rgba(${rgb},${alpha})`
    const fade = `rgba(${rgb},0)`
    // 左段：左端斜切，右端留 5px 淡出交给笔锋的淡入
    const body = `linear-gradient(102deg, ${fade} 0, ${fade} 3px, ${solid} 3.8px, ${solid} calc(100% - 5px), ${fade} 100%)`
    /**
     * 右端笔锋：固定 24px 宽，左端 5px 用渐变淡入（与主体淡出交叉）。
     * 顶点 (24,0) 起笔斜到 (15,100)，斜边拆成三段贝塞尔来回进出 2~2.5px；
     * 渐变做不出「精确从右上角起笔」的斜边，色标落在哪个角会随宽高漂移。
     */
    const outline = [
        'M0 0',
        'L24 0',
        'C20.8 12 23.5 24 21.4 36',
        'C18 48 22.4 62 19 74',
        'C17 84 16.2 92 15 100',
        'L0 100',
        'Z',
    ].join(' ')
    const svg = [
        "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 100' preserveAspectRatio='none'>",
        "<defs><linearGradient id='f' x1='0' y1='0' x2='5' y2='0' gradientUnits='userSpaceOnUse'>",
        `<stop offset='0' stop-color='rgb(${rgb})' stop-opacity='0'/>`,
        `<stop offset='1' stop-color='rgb(${rgb})' stop-opacity='${alpha}'/>`,
        '</linearGradient></defs>',
        `<path d='${outline}' fill='url(#f)'/>`,
        '</svg>',
    ].join('')
    return [
        `background-image: url("data:image/svg+xml,${encodeURIComponent(svg)}"), ${body}`,
        // 笔锋 24px；主体让出 20px，两层因此重叠 4px，正好落在 5px 的交叉过渡带上
        'background-size: 24px 100%, max(calc(100% - 20px), 0px) 100%',
        // 下移 0.1em：content area 顶部到字面上沿的空白让出来，溢出的下缘由 border box 裁掉
        'background-position: right 0.1em, 0 0.1em',
        'background-repeat: no-repeat',
        // 只加垂直 padding：横向 padding 会撑开行内盒，字距跟着变，等于改了排版
        'padding-bottom: 1px',
        // 必须显式继承：否则 globals 的 `* { font-light }` 会把标题与粗体的字重压成 300
        'font: inherit',
        'box-decoration-break: clone',
        '-webkit-box-decoration-break: clone',
    ].join('; ')
}

/**
 * 半透明底色：深浅主题下都可读，且不改变文字颜色。
 * 取色按荧光笔的取向——明度高、饱和中等，叠在文字下方不会把字压灰；
 * 与 SelectionToolbar 的色板圆点同源，改这里必须同步那份，否则点选颜色与落下的一致不了。
 */
const HIGHLIGHT_STYLES: Readonly<Record<HighlightColor, string>> = {
    amber: highlightPaint('255, 226, 122', 0.28),
    blue: highlightPaint('133, 189, 255', 0.28),
    coral: highlightPaint('255, 150, 160', 0.28),
    emerald: highlightPaint('137, 226, 160', 0.28),
    violet: highlightPaint('199, 160, 255', 0.28),
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
