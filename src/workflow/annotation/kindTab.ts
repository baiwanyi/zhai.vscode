/**
 * 标注总览的类型页签定义：视图三档（划线 / 批注 / 查询）及到列表筛选类型的映射。
 * 复用约定：选项结构取 @webview/components/SegmentedRail 的 SegmentedRailItem，筛选类型取 ./hooks；
 * 页签与标注类型是两个概念——「查询」只切视图、不查标注表，故映射为「不限」。
 * 关键约束：默认页签与列表首屏筛选必须同源（都从 DEFAULT_KIND_TAB 派生），否则首屏选中态与结果错位；
 * 选项表是模块级常量，不得放进组件体内，否则每次渲染都会重建。
 */
import type { SegmentedRailItem } from '@webview/components/SegmentedRail'
import type { AnnotationFilters } from './hooks/useAnnotationList'

/** 视图页签：划线 / 批注是标注的单一类型，查询切到 AI 解释记录 */
export type KindTab = 'highlight' | 'note' | 'query'

/** 类型页签：划线 / 批注 / 查询 */
export const KIND_TAB_OPTIONS: readonly SegmentedRailItem<KindTab>[] = [
    { value: 'highlight', label: '划线' },
    { value: 'note', label: '批注' },
    { value: 'query', label: '查询' },
]

/** 页签默认停在划线：首屏与页签选中态保持一致 */
export const DEFAULT_KIND_TAB: KindTab = 'highlight'

/** 页签 → 标注类型：查询不查标注表，按「不限」处理 */
export function toAnnotationKind(tab: KindTab): AnnotationFilters['kind'] {
    return tab === 'query' ? null : tab
}

/** 首屏标注类型：与默认页签同源，避免页签与筛选各写一份而错位 */
export const DEFAULT_ANNOTATION_KIND: AnnotationFilters['kind'] = toAnnotationKind(DEFAULT_KIND_TAB)
