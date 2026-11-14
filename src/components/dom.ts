/**
 * DOM 事件工具：跨页面复用的原生事件处理函数。
 * 复用约定：只接收 React 事件对象，不引入状态、副作用或样式约定。
 * 关键约束：挂在哪个容器由调用方决定，本模块不假设页面结构；
 * 需要「整体屏蔽」时由页面骨架统一挂载，避免逐页各写一份内联箭头函数。
 */
import type { MouseEvent } from 'react'

/** 屏蔽浏览器右键菜单：页面内的复制、链接与格式都走自有浮层，原生菜单会盖住浮层 */
export function preventContextMenu(event: MouseEvent<HTMLElement>): void {
    event.preventDefault()
}
