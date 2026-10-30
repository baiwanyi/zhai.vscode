/**
 * 提示气泡样式出口：项目内所有 Tooltip 内容共用同一份暗底亮字类名，不再由各组件各抄一份变量覆盖。
 * 复用约定：与 @components/ui/tooltip 搭配使用，把 TOOLTIP_CLASS 传给 TooltipContent 的 className；
 * 需要加宽或换字色时用 cn(TOOLTIP_CLASS, ...) 追加，不重写这两个变量，改动即全站生效。
 * 关键约束：只重写局部前景 / 背景变量——底层箭头是独立 svg（bg-foreground / fill-foreground），
 * 继承同一组变量后自动同色，不必再给箭头写子选择器；气泡固定暗底亮字，不随明暗主题翻转。
 */

/**
 * 提示气泡统一暗底亮字：--foreground 换成暗色作气泡底，--background 取页面背景色作亮字，
 * 箭头随同一组变量同色。
 */
export const TOOLTIP_CLASS = '[--foreground:#1E1E1E] [--background:var(--background)]'
