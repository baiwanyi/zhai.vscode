/**
 * 段末批注图标：构造挂在段落末尾的纯 DOM 按钮，点击由编辑区外层事件委托处理，本模块不持有状态。
 * 复用约定：外观沿用 @components/ui/button 的类名骨架——widget 由 ProseMirror 直接插 DOM，
 * 不在 React 树里，不能渲染 <Button>，只能复用同一套 Tailwind 类名；Tailwind 4 的 @source '.' 已覆盖 src 全目录，
 * 写在 .ts 里的类名字面量同样会进产物；块号属性一律经 core/domContracts 的 setAnnotationBlockAttr 写入。
 * 关键约束：颜色必须显式写 text-inherit 跟随正文——button 的用户代理样式默认取系统 buttontext，
 * 不写就不会继承所在段落的文字色；透明底、无圆角、无 hover 底色，
 * hover 只把不透明度提到 100——图标常驻段末，带底色的方块会在正文里割出一段视觉噪音；
 * 必须显式 vertical-align: text-bottom（align-text-bottom）：inline-flex 没有自己的基线，
 * 默认 baseline 会取最后一行内容的下沿、让整枚图标悬在基线上方，看起来与文字底差半个行距；
 * 尺寸一律用 em（按钮 1.5em = 一个行高，图标 1em = 行高的 2/3），随编辑器字号缩放且恰好不吃掉行距；
 * DOM 结构变化要同步装饰 key 的约定（角标数字编进 key，否则同 key 会复用旧 DOM）；
 * 单条批注不渲染角标，多条才出数字，数量包含当前段的全部有效批注。
 */
import { setAnnotationBlockAttr } from '../core/domContracts'

/**
 * 按钮外观：沿用 shadcn buttonVariants 的骨架（inline-flex / shrink-0 / border-transparent / 聚焦环 / 过渡），
 * 但去掉 ghost 的 hover 底色与圆角：图标常驻段末，带底色的方块会在正文里割出一段视觉噪音。
 * 尺寸按 em 给定——正文 line-height 固定 1.5，1em 即行高的 2/3，按钮 1.5em 正好等于一个行高，
 * 因此字号一变（VSCode 编辑器字号）图标随之缩放，且永远不会撑开行距；颜色继承段落文字色（text-inherit）。
 * 关键约束：em 能生效的前提是 Tailwind Preflight 给 button 的 `font: inherit`，别在这里另设 text-* 字号档位。
 */
const MARKER_CLASS = [
    'zhai-annotation-marker inline-flex shrink-0 items-center justify-center border border-transparent',
    'size-[1em] ml-1.5 align-text-bottom select-none',
    'text-inherit opacity-50 transition-all outline-none bg-transparent hover:opacity-100',
    'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
].join(' ')

/** 气泡图标：取 lucide 的 message-square-text，1em 与正文同字号，随行高一起缩放，描边色由按钮的 color 决定 */
const MARKER_ICON = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"',
    ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="size-[1em]" aria-hidden="true">',
    '<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/>',
    '<path d="M7 11h10"/>',
    '<path d="M7 15h6"/>',
    '<path d="M7 7h8"/>',
    '</svg>',
].join('')

/** 造一枚段末批注图标：块号用于点击后定位该段，count 为该段有效批注条数 */
export function createAnnotationMarker(blockIndex: number, count: number): HTMLElement {
    const marker = document.createElement('button')
    marker.type = 'button'
    marker.className = MARKER_CLASS
    setAnnotationBlockAttr(marker, blockIndex)
    marker.setAttribute('aria-label', `第 ${String(blockIndex + 1)} 段有 ${String(count)} 条批注`)
    marker.innerHTML = MARKER_ICON
    if (count > 1) {
        const badge = document.createElement('span')
        // 数字压到 0.75em：正文同字号放不进 1.5em 的按钮，同时保证跟随字号缩放
        badge.className = 'tabular-nums text-[0.75em] leading-none'
        badge.textContent = String(count)
        marker.append(badge)
    }
    return marker
}
