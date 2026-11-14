/**
 * 编辑器 DOM 契约：正文 / 版心 / 滚动容器的类名与段末批注图标属性，供事件委托与定位共用。
 * 复用约定：editor.css 与 annotations/annotationDecorations 负责写 DOM，本模块只提供读取侧常量。
 * 关键约束：类名改名前必须同步 editor.css 与全部 closest 调用点（TS 无法约束 CSS）；
 * data-annotation-block 由 widget 写成字符串，读回时必须按非负整数校验——空串经 Number 会变成 0；
 * 命中判定只能用 Element：图标内部是 SVG，点到的是 SVGElement，收窄成 HTMLElement 会让图标失效。
 */

/** 最外层容器：标题导航以它为定位基准 */
export const EDITOR_ROOT_CLASS = 'zhai-editor'

/** 滚动容器：正文与弹层的滚动收起都挂在这里 */
export const EDITOR_SCROLL_CLASS = 'zhai-editor-scroll'

/** 版心：块把手、行号栏与表格工具的定位基准（position: relative） */
export const EDITOR_PAGE_CLASS = 'zhai-editor-page'

/** ProseMirror 编辑区：与 target 全等比较时用于识别「点在正文空白处」 */
export const EDITOR_CONTENT_CLASS = 'zhai-editor-content'

/** 段末批注图标的块号属性 */
export const ANNOTATION_BLOCK_ATTR = 'data-annotation-block'

/**
 * 悬浮 Popover 的壳：宽高与底色、内边距、阴影、描边全部让给内部块（工具条 / InputGroup），
 * 否则弹层自带的装饰会与内部块叠成双层边框。
 */
export const FLOATING_POPOVER_CLASS = 'w-auto border-0 bg-transparent p-0 shadow-none ring-0'

/** 段末批注图标：块号与图标矩形一次取出，调用方据此定位弹层 */
export interface AnnotationMarker {
    blockIndex: number
    rect: DOMRect
}

/**
 * 从事件目标向上找段末批注图标；命中返回块号与矩形，否则 null。
 * 判定基准必须是 Element：图标主体是内联 SVG，点上去的 target 是 SVGElement 而不是 HTMLElement，
 * 只认 HTMLElement 会让整枚图标（按钮上几乎没有 SVG 之外的空白）完全点不动。
 */
export function readAnnotationMarker(target: EventTarget | null): AnnotationMarker | null {
    if (!(target instanceof Element)) {
        return null
    }
    const marker = target.closest(`[${ANNOTATION_BLOCK_ATTR}]`)
    if (!(marker instanceof HTMLElement)) {
        return null
    }
    const blockIndex = Number(marker.dataset.annotationBlock)
    if (!Number.isInteger(blockIndex) || blockIndex < 0) {
        return null
    }
    return { blockIndex, rect: marker.getBoundingClientRect() }
}
