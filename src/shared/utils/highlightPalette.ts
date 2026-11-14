/**
 * 划线与标注共用的色板：枚举值、中文名、CSS 色值与 RGB 分量只在这里定义一次。
 * 复用约定：库里存的是 HighlightColor 枚举值，本模块只提供展示所需数据，不参与任何持久化；
 * 编辑区色板与标注总览页的筛选、列表圆点都从这里取，避免「筛选选蓝色、划线却落成别的蓝」。
 * 关键约束：未知或空值一律回落中性色而不是抛错——历史数据与脏值不该让整页渲染失败。
 */
import type { HighlightColor } from '@shared/types/editor'

export interface HighlightColorSpec {
    value: HighlightColor
    label: string
    /** 不透明色值：编辑区色板圆点与总览页圆点共用，便于辨认 */
    css: string
    /**
     * 同一颜色的 RGB 分量（`255, 226, 122` 形态）。
     * 划线笔触要在 SVG 的 stop-color 与 rgba() 里分别拼装，都得用分量而不是现成的 rgb() 字符串；
     * 与 css 同源于一处定义，避免「色板圆点一个蓝、落下划线另一个蓝」。
     */
    rgb: string
}

/** 色板：按枚举值字母序排列，改顺序即同时改两个界面的展示顺序 */
export const HIGHLIGHT_PALETTE: readonly HighlightColorSpec[] = [
    { value: 'amber', label: '琥珀黄', css: 'rgb(255, 226, 122)', rgb: '255, 226, 122' },
    { value: 'blue', label: '湖蓝', css: 'rgb(133, 189, 255)', rgb: '133, 189, 255' },
    { value: 'coral', label: '珊瑚红', css: 'rgb(255, 150, 160)', rgb: '255, 150, 160' },
    { value: 'emerald', label: '青绿', css: 'rgb(137, 226, 160)', rgb: '137, 226, 160' },
    { value: 'violet', label: '紫罗兰', css: 'rgb(199, 160, 255)', rgb: '199, 160, 255' },
]

/** 默认划线色：琥珀黄，最接近荧光笔在纸面上的观感，首次使用不必先选色 */
export const DEFAULT_HIGHLIGHT_COLOR: HighlightColor = 'amber'

/** 取颜色对应的 CSS 值：未知或空值回落到透明 */
export function readHighlightCss(color: HighlightColor | null): string {
    return HIGHLIGHT_PALETTE.find((item) => item.value === color)?.css ?? 'transparent'
}

/** 取颜色对应的 RGB 分量：未知或空值回落到中性灰，拼接 SVG / rgba() 时不会产出非法色值 */
export function readHighlightRgb(color: HighlightColor | null): string {
    return HIGHLIGHT_PALETTE.find((item) => item.value === color)?.rgb ?? '136, 136, 136'
}
