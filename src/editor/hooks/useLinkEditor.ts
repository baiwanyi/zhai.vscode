/**
 * 链接输入态：开合地址面板、回填已有链接、应用与移除，状态机与命令执行收在一处。
 * 复用约定：地址解析与命令取 toolbar/formatCommands，只读守卫取 toolbar/editableGuard，
 * 失败一律 toast 说明；面板自身的显隐与草稿归本 hook，与色板的互斥由调用方处理。
 * 关键约束：所有写入都按外层冻结的 range 执行——点按钮会让选区塌陷，现读不可靠；
 * 摘链不抢焦点也不关浮层，抢焦点会让选区离开这段文字，之后点它不再弹；
 * 每次成功写入都要回调 onCommitted 立即落盘，否则会被 500ms 回写防抖当成「没保存」。
 */
import { useState } from 'react'
import { toast } from 'sonner'
import type { FrozenRange } from '../toolbar/formatCommands'
import type { Editor } from '@tiptap/react'
import { ensureEditable } from '../toolbar/editableGuard'
import {
    applySelectionLink,
    normalizeLinkHref,
    readSelectionLink,
    removeSelectionLink,
    toEditableHref,
} from '../toolbar/formatCommands'

export interface LinkEditorState {
    /** 地址面板是否展开 */
    isEditing: boolean
    /** 输入框里的草稿：由表单单向驱动，不参与「选区是否有链接」的判定 */
    value: string
    /** 选区上真的存在链接（不是输入框草稿） */
    hasLink: boolean
    /** 开合面板：打开时把已有地址回填进草稿 */
    toggle: () => void
    change: (value: string) => void
    apply: () => void
    remove: () => void
    cancel: () => void
}

export function useLinkEditor(editor: Editor, range: FrozenRange, onCommitted: () => void): LinkEditorState {
    const [isEditing, setIsEditing] = useState(false)
    const [value, setValue] = useState('')
    // 选区上是否真有链接：删除入口只认它，不能跟着输入框里的草稿走
    const [hasLink, setHasLink] = useState(false)

    const change = (nextValue: string): void => {
        setValue(nextValue)
    }

    const cancel = (): void => {
        setIsEditing(false)
    }

    const toggle = (): void => {
        if (isEditing) {
            setIsEditing(false)
            return
        }
        if (editor.schema.marks.link === undefined) {
            toast.error('当前编辑器未启用链接')
            return
        }
        // 没有选中文字就无从套链接：静默不弹面板会让人以为按钮坏了
        if (range.from >= range.to) {
            toast.error('请先选中要加链接的文字')
            return
        }
        // 已有链接预填进来便于改地址：按菜单冻结的范围读，点击态下选区只有塌陷光标
        const href = readSelectionLink(editor, range)
        setValue(toEditableHref(href))
        setHasLink(href.length > 0)
        setIsEditing(true)
    }

    const apply = (): void => {
        if (!ensureEditable(editor)) {
            return
        }
        if (range.from >= range.to) {
            toast.error('请先选中要加链接的文字')
            return
        }
        const href = normalizeLinkHref(value)
        if (href === null) {
            toast.error('链接地址不可用：仅支持 http(s)、mailto 或站内路径')
            return
        }
        if (!applySelectionLink(editor, range, href)) {
            toast.error('链接未能写入：请重新选中文字后再试')
            return
        }
        setHasLink(true)
        // 只收起地址面板，浮层留着：同一段文字往往还要接着划线或再改地址
        setIsEditing(false)
        onCommitted()
    }

    const remove = (): void => {
        if (!ensureEditable(editor)) {
            return
        }
        if (!removeSelectionLink(editor, range)) {
            toast.error('取消链接未生效：请重新选中文字后再试')
            return
        }
        setHasLink(false)
        // 不 focus 也不关浮层：摘链只改 mark，抢焦点会让选区离开这段文字
        setIsEditing(false)
        onCommitted()
    }

    return { isEditing, value, hasLink, toggle, change, apply, remove, cancel }
}
