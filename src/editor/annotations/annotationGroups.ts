/**
 * 标注分组：把当前文档的标注记录按「顶层块下标」聚合成装饰层直接可用的两种视图数据。
 * 复用约定：纯函数，只读 AnnotationRecord，不碰编辑器、DOM 与装饰 API，可单独构造列表验证规则；
 * 口径与装饰构建保持一致——blockIndex 取 doc 原始顺序（含空文本块），orphaned 一律跳过。
 * 关键约束：划线必须同时有 quote 与 color，任一缺失即丢弃，不做回落（画错位置比不画更糟）；
 * 必须一次遍历完成分组：逐块过滤是「块数 × 标注数」的乘积，长文档叠上密集批注会明显放大。
 */
import type { AnnotationRecord, HighlightColor } from '@shared/types/editor'

/** 块内的一条划线：装饰层据此在块内定位 quote 并上色 */
export interface BlockHighlight {
    quote: string
    color: HighlightColor
}

/** 按块分组的渲染数据：批注只需要条数，划线需要原文与颜色 */
export interface BlockAnnotationGroups {
    noteCounts: ReadonlyMap<number, number>
    highlights: ReadonlyMap<number, readonly BlockHighlight[]>
}

/** 分组当前文档的标注：批注计条数、划线收集 quote + color，顺序保持 items 原序（装饰顺序不变） */
export function groupAnnotationsByBlock(items: readonly AnnotationRecord[]): BlockAnnotationGroups {
    const noteCounts = new Map<number, number>()
    const highlights = new Map<number, BlockHighlight[]>()
    for (const item of items) {
        if (item.orphaned) {
            continue
        }
        if (item.kind === 'note') {
            noteCounts.set(item.blockIndex, (noteCounts.get(item.blockIndex) ?? 0) + 1)
            continue
        }
        if (item.kind !== 'highlight' || item.color === null || item.quote.length === 0) {
            continue
        }
        const bucket = highlights.get(item.blockIndex)
        if (bucket === undefined) {
            highlights.set(item.blockIndex, [{ quote: item.quote, color: item.color }])
            continue
        }
        bucket.push({ quote: item.quote, color: item.color })
    }
    return { noteCounts, highlights }
}
