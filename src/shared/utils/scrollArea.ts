/**
 * ScrollArea 视口的 DOM 标记：选择器对应 @components/ui/scroll-area 的 Viewport 节点。
 * 复用约定：需要「找滚动宿主」的 JS 逻辑统一从这里取（续载哨兵、底栏遮罩联动、限高测量），不再各自硬编码。
 * 关键约束：依赖 shadcn 封装的槽位属性而非 Radix 内部属性——前者在项目源码里可见，后者只能翻 node_modules；
 * Tailwind 类名无法插入 JS 常量，用到该选择器的变体（如 [&_[data-slot=scroll-area-viewport]>div]）须与此处保持一致；
 * resources/shadcn 是托管源码，不在其中新增导出，否则下次同步会被覆盖。
 */
export const SCROLL_VIEWPORT_SELECTOR = '[data-slot="scroll-area-viewport"]'
