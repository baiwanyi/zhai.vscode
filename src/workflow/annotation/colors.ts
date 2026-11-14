/**
 * 标注色板：总览页筛选与列表圆点共用同一份定义，避免「筛选选蓝色、列表显示别的蓝」。
 * 复用约定：库里存的是枚举值，这里只提供展示所需的 CSS 值，不参与任何持久化。
 * 关键约束：未知颜色回落到中性色而不是抛错——历史数据或脏值不应让整页渲染失败。
 */
import type { HighlightColor } from '@shared/types/editor'

export interface AnnotationColorOption {
    value: HighlightColor
    label: string
    css: string
}

/**
 * 色板：按枚举值字母序排列；色值与文案与编辑区 SelectionToolbar 的色板同源，
 * 改这里要同步那一份，否则总览页的圆点会和划线落下的颜色对不上。
 */
export const ANNOTATION_COLORS: readonly AnnotationColorOption[] = [
    { value: 'amber', label: '琥珀黄', css: 'rgb(255, 226, 122)' },
    { value: 'blue', label: '湖蓝', css: 'rgb(133, 189, 255)' },
    { value: 'coral', label: '珊瑚红', css: 'rgb(255, 150, 160)' },
    { value: 'emerald', label: '青绿', css: 'rgb(137, 226, 160)' },
    { value: 'violet', label: '紫罗兰', css: 'rgb(199, 160, 255)' },
]

/** 取颜色对应的 CSS 值：未知或空值回落到透明 */
export function readColorCss(color: HighlightColor | null): string {
    return ANNOTATION_COLORS.find((item) => item.value === color)?.css ?? 'transparent'
}
