/**
 * 把手定位：从块 DOM 量出「正文左边缘 + 块首行」的锚点，并把把手写成相对 offsetParent 的绝对坐标。
 * 复用约定：纯 DOM 测量，不碰 React 与组件状态；常驻定位与拖放后校准都走 positionHandleAt。
 * 关键约束：对齐基准是块的首行而不是整块——多行段落若居中对齐，按钮会掉到两行文字之间；
 * left/top 必须相对 offsetParent 计算，扩展创建的 wrapper 才是绝对定位的包含块；
 * wrapper 类名由 HANDLE_WRAPPER_CLASS 与 editor.css 共用，改它要同步 CSS。
 */
import { readTopBlockPos } from './blockQueries'
import type { Editor } from '@tiptap/core'

/** drag-handle 扩展 wrapper 的类名：editor.css 与定位查询共用这一个名字，改它要同步 CSS */
export const HANDLE_WRAPPER_CLASS = 'drag-handle'

/** 正文行高：与 editor.css 的 .zhai-editor-content（line-height: 2rem）保持一致 */
const CONTENT_LINE_HEIGHT = 32

/**
 * 块首行的视口矩形：把手要对齐第一行，不能按整块的垂直中线——
 * 多行段落若居中对齐，按钮会掉到两行文字之间，看不出它在拖哪一块。
 * 取首个文本节点的首字符测行盒；空块、图片这类没有文本的块退回整块矩形。
 */
export function firstLineRect(element: HTMLElement): DOMRect {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const textNode = walker.nextNode()
    const text = textNode?.textContent ?? ''
    if (textNode === null || text.length === 0) {
        return element.getBoundingClientRect()
    }
    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, 1)
    // 部分环境（jsdom）没有 Range.getBoundingClientRect，退回整块矩形，不能让异常中断定位
    const rect =
        typeof range.getBoundingClientRect === 'function'
            ? range.getBoundingClientRect()
            : element.getBoundingClientRect()
    return rect.height > 0 ? rect : element.getBoundingClientRect()
}

/**
 * 把手锚点矩形：水平取正文左边缘（所有顶层块都对齐在这一条线上），
 * 垂直取块首行，块内 padding 不会再把手把推向右边，滑动时只在一条竖线上走。
 */
export function handleAnchorRect(editor: Editor, dom: HTMLElement): DOMRect {
    const line = firstLineRect(dom)
    const content = editor.view.dom.getBoundingClientRect()
    // 图片、表格这类没有文本的块，firstLineRect 会退回整块矩形；高度收到一行，
    // 否则把手会被垂直居中到整块中间（高图片尤其明显），没法贴住块顶部
    const height = Math.min(line.height, CONTENT_LINE_HEIGHT)
    return new DOMRect(content.left, line.top, 0, height)
}

/** 把手根节点：drag-handle 扩展把 wrapper 挂在编辑器的父节点上，常驻定位直接写它的 left/top */
export function findHandleElement(editor: Editor): HTMLElement | null {
    if (editor.isDestroyed) {
        return null
    }
    const selector = `.${HANDLE_WRAPPER_CLASS}`
    const host = editor.view.dom.parentElement
    const inHost = host?.querySelector<HTMLElement>(selector) ?? null
    if (inHost !== null) {
        return inHost
    }
    // EditorContent 初始化时会整体搬移 view.dom 的兄弟节点，扩展 append 的 wrapper 可能落在
    // 已脱离文档的旧容器里；兜底到文档范围查找（editor.css 只服务 editor 入口，单实例）
    return document.querySelector<HTMLElement>(selector)
}

/**
 * 把把手移到指定块的左侧：hoverPos 是鼠标所在块（与扩展一致），为空时退回光标块。
 * left/top 必须相对 element 的 offsetParent 计算 —— 扩展创建的 wrapper 才是绝对定位的包含块，
 * 拿编辑区容器的矩形当基准会整体偏出一个版心内边距（横向差 72px、纵向差 40px）。
 * 返回是否真的写入了位置：挂载初期扩展的 wrapper 还没建好，调用方据此决定要不要显示。
 */
export function positionHandleAt(editor: Editor, hoverPos: number | null): boolean {
    const handle = findHandleElement(editor)
    const pos = hoverPos ?? readTopBlockPos(editor)
    const dom = pos === null ? null : editor.view.nodeDOM(pos)
    const owner = handle?.offsetParent ?? editor.view.dom.parentElement
    const base = owner instanceof HTMLElement ? owner.getBoundingClientRect() : null
    if (handle === null || base === null || !(dom instanceof HTMLElement)) {
        return false
    }
    const rect = handleAnchorRect(editor, dom)
    const handleRect = handle.getBoundingClientRect()
    // wrapper 的内容由 portal 渲染，首帧可能还没有尺寸；此时用设计尺寸兜底，
    // 宁可位置差一两像素，也不能因为量不到宽高就让把手永远不出现
    const handleWidth = handleRect.width === 0 ? 60 : handleRect.width
    const handleHeight = handleRect.height === 0 ? 24 : handleRect.height
    handle.style.left = `${rect.left - base.left - handleWidth}px`
    handle.style.top = `${rect.top - base.top + (rect.height - handleHeight) / 2}px`
    return true
}
