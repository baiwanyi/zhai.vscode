/**
 * 编辑器焦点策略：浮层与菜单关闭时不许 Radix 把焦点还给触发元素，否则正文失焦、选区塌陷。
 * 复用约定：focusEditor 是无条件交回正文的统一入口，returnFocusToEditor 直接拿去填 onCloseAutoFocus。
 * 关键约束：表情选择器等长驻浮层依赖「焦点留在正文」才能存活，焦点一被抢走就表现为「点了没反应」；
 * 这里只管焦点，不判断可写性——只读文档下聚焦正文仍是合法操作。
 */
import type { Editor } from '@tiptap/core'

/** 把焦点交回正文：命令与菜单关闭后的统一入口 */
export function focusEditor(editor: Editor): void {
    editor.chain().focus().run()
}

/** Radix 菜单 / 浮层关闭时用：拦掉归还焦点的默认行为并交回正文，直接传给 onCloseAutoFocus */
export function returnFocusToEditor(editor: Editor): (event: Event) => void {
    return (event): void => {
        event.preventDefault()
        focusEditor(editor)
    }
}
