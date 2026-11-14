/**
 * 标注色板：总览页筛选与列表圆点共用同一份定义，避免「筛选选蓝色、列表显示别的蓝」。
 * 复用约定：色值与中文名统一取 @shared/utils/highlightPalette，本文件只保留标注模块的导出名；
 * 库里存的是枚举值，这里只提供展示所需的 CSS 值，不参与任何持久化。
 * 关键约束：未知颜色回落到中性色而不是抛错——历史数据或脏值不应让整页渲染失败。
 */
import type { HighlightColor } from '@shared/types/editor'
import { HIGHLIGHT_PALETTE, readHighlightCss } from '@shared/utils/highlightPalette'
import type { HighlightColorSpec } from '@shared/utils/highlightPalette'

/** 历史导出名：与编辑区色板共用同一形状 */
export type AnnotationColorOption = HighlightColorSpec

/** 色板：按枚举值字母序排列，与编辑区划线色板同源 */
export const ANNOTATION_COLORS: readonly AnnotationColorOption[] = HIGHLIGHT_PALETTE

/** 取颜色对应的 CSS 值：未知或空值回落到透明 */
export function readColorCss(color: HighlightColor | null): string {
    return readHighlightCss(color)
}
