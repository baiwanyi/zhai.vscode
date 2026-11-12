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

export const ANNOTATION_COLORS: readonly AnnotationColorOption[] = [
    { value: 'coral', label: '珊瑚', css: 'rgb(255, 138, 128)' },
    { value: 'violet', label: '紫罗兰', css: 'rgb(186, 140, 255)' },
    { value: 'blue', label: '蓝', css: 'rgb(120, 170, 255)' },
    { value: 'emerald', label: '青', css: 'rgb(110, 220, 170)' },
    { value: 'amber', label: '琥珀', css: 'rgb(255, 205, 120)' },
]

/** 取颜色对应的 CSS 值：未知或空值回落到透明 */
export function readColorCss(color: HighlightColor | null): string {
    return ANNOTATION_COLORS.find((item) => item.value === color)?.css ?? 'transparent'
}
