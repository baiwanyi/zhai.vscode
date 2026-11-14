/**
 * 划线笔触样式：把色板的 RGB 分量拼成「主体 + 笔锋」两层背景，并合成最终的 inline style 字符串。
 * 复用约定：颜色一律经 @shared/utils/highlightPalette 的 readHighlightRgb 取，本模块只负责把 RGB 变成 CSS / SVG；
 * 不依赖 ProseMirror 与 React，可单独喂任意 rgb 与 alpha 验证产物。
 * 关键约束：绝不能用 mask——遮罩作用于元素的全部内容，斜切与起伏的边缘会把同一段文字一起裁掉，
 * 看起来就是「划完线字变细、变样」；只有背景层不碰任何排版属性。
 * 也不能让两层硬碰硬：重叠处半透明颜色叠加会变深，不重叠则两条抗锯齿淡边拼成白线，
 * 这里让主体右端最后 5px 淡出、笔锋左端 5px 淡入，接缝才既不是白线也不是深线；
 * span 会命中 globals 的 `* { font-light }`，不写 `font: inherit` 会把标题与粗体的字重一并压成 300；
 * `box-decoration-break: clone` 保证跨行时每行都独立成套笔触，而不是整段只有首尾两处切口。
 */
import type { HighlightColor } from '@shared/types/editor'
import { readHighlightRgb } from '@shared/utils/highlightPalette'

/** 划线浓度：荧光笔叠在文字下方仍可读的取值，五个颜色共用 */
const HIGHLIGHT_ALPHA = 0.28

/** 笔锋宽度：固定 24px，端部按像素走，不随划线长度缩放 */
const STROKE_WIDTH = 24

/**
 * 右端笔锋的 SVG 遮罩：固定 24px 宽，左端 5px 用渐变淡入（与主体淡出交叉）。
 * 顶点 (24,0) 起笔斜到 (15,100)，斜边拆成三段贝塞尔来回进出 2~2.5px；
 * 渐变做不出「精确从右上角起笔」的斜边，色标落在哪个角会随宽高漂移。
 */
function buildStrokeMask(rgb: string, alpha: number): string {
    const outline = [
        'M0 0',
        `L${String(STROKE_WIDTH)} 0`,
        'C20.8 12 23.5 24 21.4 36',
        'C18 48 22.4 62 19 74',
        'C17 84 16.2 92 15 100',
        'L0 100',
        'Z',
    ].join(' ')
    const svg = [
        `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${String(STROKE_WIDTH)} 100' preserveAspectRatio='none'>`,
        "<defs><linearGradient id='f' x1='0' y1='0' x2='5' y2='0' gradientUnits='userSpaceOnUse'>",
        `<stop offset='0' stop-color='rgb(${rgb})' stop-opacity='0'/>`,
        `<stop offset='1' stop-color='rgb(${rgb})' stop-opacity='${String(alpha)}'/>`,
        '</linearGradient></defs>',
        `<path d='${outline}' fill='url(#f)'/>`,
        '</svg>',
    ].join('')
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

/**
 * 主体：贯通整行的渐变条，左端斜切，右端留 5px 淡出交给笔锋的淡入。
 * 斜切角度用 102deg 而不是硬切分，端头才不会出现一条整齐的竖边。
 */
function buildBodyGradient(rgb: string, alpha: number): string {
    const solid = `rgba(${rgb},${alpha})`
    const fade = `rgba(${rgb},0)`
    return `linear-gradient(102deg, ${fade} 0, ${fade} 3px, ${solid} 3.8px, ${solid} calc(100% - 5px), ${fade} 100%)`
}

/**
 * 与颜色无关的排版属性：所有划线共用，改这里即改全部划线。
 * 只加垂直 padding：横向 padding 会撑开行内盒，字距跟着变，等于改了排版；
 * 下移 0.1em 让出 content area 顶部到字面上沿的空白，溢出的下缘由 border box 裁掉。
 */
const HIGHLIGHT_LAYOUT_STYLE = [
    // 笔锋 24px；主体让出 20px，两层因此重叠 4px，正好落在 5px 的交叉过渡带上
    `background-size: ${String(STROKE_WIDTH)}px 100%, max(calc(100% - 20px), 0px) 100%`,
    'background-position: right 0.1em, 0 0.1em',
    'background-repeat: no-repeat',
    'padding-bottom: 1px',
    // 必须显式继承：否则 globals 的 `* { font-light }` 会把标题与粗体的字重压成 300
    'font: inherit',
    'box-decoration-break: clone',
    '-webkit-box-decoration-break: clone',
].join('; ')

/** 按给定 RGB 分量拼一条完整划线样式：两层背景 + 固定排版属性 */
export function buildHighlightStyle(rgb: string, alpha: number = HIGHLIGHT_ALPHA): string {
    return [
        `background-image: ${buildStrokeMask(rgb, alpha)}, ${buildBodyGradient(rgb, alpha)}`,
        HIGHLIGHT_LAYOUT_STYLE,
    ].join('; ')
}

/**
 * 五个颜色的装饰样式：颜色值只在色板里定义一次，这里只按枚举逐项拼装。
 * 用字面量而不是 Object.fromEntries 循环，是为了让枚举新增颜色时 TS 直接报缺键。
 */
export const HIGHLIGHT_STYLES: Readonly<Record<HighlightColor, string>> = {
    amber: buildHighlightStyle(readHighlightRgb('amber')),
    blue: buildHighlightStyle(readHighlightRgb('blue')),
    coral: buildHighlightStyle(readHighlightRgb('coral')),
    emerald: buildHighlightStyle(readHighlightRgb('emerald')),
    violet: buildHighlightStyle(readHighlightRgb('violet')),
}
