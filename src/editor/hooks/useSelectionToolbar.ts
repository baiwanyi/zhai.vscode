/**
 * 选区浮动菜单状态：把 ProseMirror 选区换算成视口坐标与菜单开关。
 * 复用约定：坐标取 editor.view.coordsAtPos，与 shadcn Popover 的 fixed 锚点配合；
 * 关闭条件统一收敛在此（选区塌陷、过短、滚动、缩放、Esc、点击外部）。
 * 关键约束：拖动选区会连续触发 selectionUpdate，位置更新按 120ms 节流避免浮层抖动；
 * 不读 window.getSelection——富文本内它与 editor.state.selection 会短暂不一致。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'

/** 菜单最小触发长度：一两个字符的选区多半是误触 */
const MIN_SELECTION_CHARS = 2

/** 位置更新节流：拖动选区时避免浮层跟着抖 */
const POSITION_THROTTLE_MS = 120

/** 浮层与视口边缘的最小留白 */
const VIEWPORT_PADDING = 60

export interface SelectionToolbarState {
    isOpen: boolean
    left: number
    top: number
    /** 选中的纯文本：复制与后续查询共用 */
    text: string
    /** 主动关闭（点击外部、Esc、滚动）：同一次选区不自动重开 */
    dismiss: () => void
}

export function useSelectionToolbar(editor: Editor | null): SelectionToolbarState {
    const [state, setState] = useState({ isOpen: false, left: 0, top: 0, text: '' })
    const dismissedRef = useRef(false)
    const lastRangeRef = useRef({ from: -1, to: -1 })
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const dismiss = useCallback((): void => {
        dismissedRef.current = true
        setState((prev) => ({ ...prev, isOpen: false }))
    }, [])

    /** 重新计算选区与坐标：同一次选区在用户主动关闭后不再自动弹回 */
    const refresh = useCallback((): void => {
        if (editor === null) {
            return
        }
        const { from, to } = editor.state.selection
        if (from === to) {
            setState((prev) => ({ ...prev, isOpen: false }))
            return
        }
        const text = editor.state.doc.textBetween(from, to, '\n').trim()
        if (text.length < MIN_SELECTION_CHARS) {
            setState((prev) => ({ ...prev, isOpen: false }))
            return
        }
        const isSameRange = lastRangeRef.current.from === from && lastRangeRef.current.to === to
        if (isSameRange && dismissedRef.current) {
            return
        }
        if (!isSameRange) {
            dismissedRef.current = false
            lastRangeRef.current = { from, to }
        }
        const start = editor.view.coordsAtPos(from)
        const end = editor.view.coordsAtPos(to)
        const centerX = (start.left + end.right) / 2
        const left = Math.min(Math.max(centerX, VIEWPORT_PADDING), window.innerWidth - VIEWPORT_PADDING)
        setState({ isOpen: true, left, top: Math.min(start.top, end.top) - 6, text })
    }, [editor])

    useEffect(() => {
        if (editor === null) {
            return
        }
        const handleUpdate = (): void => {
            if (timerRef.current !== null) {
                return
            }
            timerRef.current = setTimeout((): void => {
                timerRef.current = null
                refresh()
            }, POSITION_THROTTLE_MS)
        }
        const handleKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                dismiss()
            }
        }
        editor.on('selectionUpdate', handleUpdate)
        window.addEventListener('scroll', dismiss, true)
        window.addEventListener('resize', dismiss)
        window.addEventListener('keydown', handleKeyDown)
        return (): void => {
            editor.off('selectionUpdate', handleUpdate)
            window.removeEventListener('scroll', dismiss, true)
            window.removeEventListener('resize', dismiss)
            window.removeEventListener('keydown', handleKeyDown)
            if (timerRef.current !== null) {
                clearTimeout(timerRef.current)
                timerRef.current = null
            }
        }
    }, [dismiss, editor, refresh])

    return { ...state, dismiss }
}
