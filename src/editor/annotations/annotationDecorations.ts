/**
 * 标注装饰：把标注记录换算成视图层装饰——划线铺马克笔笔触，批注挂段末图标，均不进入文档模型。
 * 复用约定：分组取 ./annotationGroups，笔触样式取 ./annotationHighlightStyle，图标取 ./annotationMarker，
 * 插件与写入入口取 ./annotationPlugin；本文件只做「记录 → 文档位置 → 装饰」的换算与拼装。
 * 关键约束：用 Decoration.inline 而不是 Mark——Mark 会被 getHTML 序列化进 Markdown，往返还得额外剥离；
 * 只定位顶层文本块（段落 / 标题 / 代码块），列表与引用内的嵌套段落暂不处理；
 * 定位用 quote 而不是字符偏移——Markdown 源码偏移与 ProseMirror 位置口径不同（标记占位、换行折叠），
 * 直接用偏移会错位；quote 是纯文本，块内匹配更可靠；
 * widget 的 key 必须编入条数：WidgetType.eq 在 spec.key 相同时直接判等，同 key 会复用旧 DOM，
 * 角标数字与 aria-label 就永远停在首次渲染的值。
 */
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { AnnotationRecord } from '@shared/types/editor'
import { groupAnnotationsByBlock } from './annotationGroups'
import { HIGHLIGHT_STYLES } from './annotationHighlightStyle'
import { createAnnotationMarker } from './annotationMarker'
import { applyDecorationSet } from './annotationPlugin'
import type { BlockAnnotationGroups } from './annotationGroups'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { Editor } from '@tiptap/react'

/**
 * 单块内的装饰：划线按 quote 在块内首个匹配处上色，批注落在块末（nodeSize - 1）。
 * 块内找不到 quote 时静默跳过——文本被改动过，宁可少画一条也不能画错位置。
 */
function buildBlockDecorations(
    node: ProseMirrorNode,
    offset: number,
    index: number,
    groups: BlockAnnotationGroups,
): Decoration[] {
    const decorations: Decoration[] = []
    const highlights = groups.highlights.get(index)
    if (highlights !== undefined && highlights.length > 0) {
        const text = node.textContent
        for (const highlight of highlights) {
            const localStart = text.indexOf(highlight.quote)
            if (localStart < 0) {
                continue
            }
            // 文本块的内容从 offset + 1 开始，块内偏移加上这个基准才是文档位置
            const from = offset + 1 + localStart
            decorations.push(
                Decoration.inline(from, from + highlight.quote.length, { style: HIGHLIGHT_STYLES[highlight.color] }),
            )
        }
    }
    const noteCount = groups.noteCounts.get(index)
    if (noteCount !== undefined && noteCount > 0) {
        decorations.push(
            Decoration.widget(offset + node.nodeSize - 1, createAnnotationMarker(index, noteCount), {
                side: 1,
                // 数量必须编进 key：同 key 会复用旧 DOM，角标数字与 aria-label 就停在首次渲染的值
                key: `zhai-note-${String(index)}-${String(noteCount)}`,
            }),
        )
    }
    return decorations
}

/** 按分组结果构建整篇装饰：非文本块（表格、图片、分隔线）不挂任何标注装饰 */
export function buildAnnotationDecorations(doc: ProseMirrorNode, groups: BlockAnnotationGroups): DecorationSet {
    const decorations: Decoration[] = []
    doc.content.forEach((node, offset, index) => {
        if (!node.isTextblock) {
            return
        }
        decorations.push(...buildBlockDecorations(node, offset, index, groups))
    })
    return DecorationSet.create(doc, decorations)
}

/** 重建并投递当前文档的标注装饰：orphaned 条目在分组阶段已剔除，这里不再判 */
export function applyAnnotationDecorations(editor: Editor, items: readonly AnnotationRecord[]): void {
    const groups = groupAnnotationsByBlock(items)
    applyDecorationSet(editor, buildAnnotationDecorations(editor.state.doc, groups))
}
