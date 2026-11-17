/**
 * ScrollArea 视口的 DOM 标记：选择器对应 @components/ui/scroll-area 的 Viewport 节点。
 * 复用约定：需要拿到滚动宿主的逻辑（续载哨兵、滚动监听、限高）统一从这里取选择器，不再各自硬编码。
 * 关键约束：依赖的是 shadcn 组件的内部标记而非公开 API，升级改了 data-slot 值只需改这一处；
 * resources/shadcn 是托管源码，不在其中新增导出，否则下次同步会被覆盖。
 */
export const SCROLL_VIEWPORT_SELECTOR = '[data-slot="scroll-area-viewport"]'
