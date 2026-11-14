/**
 * 选区划线颜色反查：按「块序号 + 选中的原文」找出当前选区上那条划线的颜色。
 * 复用约定：只读 AnnotationRecord 列表，不碰编辑器状态；块序号取 readTopBlockIndexAt 的原始口径
 * （doc 顺序、含空文本块），与「跳过空块」的快照口径不可混用。
 * 关键约束：只认未失效的划线（orphaned 跳过），块序号与原文必须同时命中才返回颜色；
 * 任何不确定都返回 null，由调用方回落到默认色——宁可显示默认色，也不能显示错的颜色。
 */
import type { AnnotationRecord, HighlightColor } from '@shared/types/editor'

/** 找选区上那条划线的颜色：命中返回颜色，未命中或信息不足返回 null */
export function findHighlightColor(
    items: readonly AnnotationRecord[],
    blockIndex: number,
    quote: string,
): HighlightColor | null {
    if (blockIndex < 0 || quote.length === 0) {
        return null
    }
    const matched = items.find(
        (item) =>
            item.kind === 'highlight' &&
            !item.orphaned &&
            item.blockIndex === blockIndex &&
            item.quote === quote &&
            item.color !== null,
    )
    return matched?.color ?? null
}
