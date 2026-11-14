/**
 * 表情选择器会话：斜杠命令只负责「打开」，弹层拿到编辑器引用与锚点后自行插入。
 * 复用约定：与 slashStore 同一套模块级单例 + useSyncExternalStore，不引入 Context。
 * 关键约束：保存 editor 引用而不是位置区间——插入时用当前选区，
 * 用户可能在弹层里先搜索再定位，位置区间此时已经过期。
 */
import type { Editor } from '@tiptap/react'

export interface EmojiSession {
    editor: Editor
    /** 锚点：取斜杠命令执行后的光标坐标 */
    left: number
    top: number
}

let session: EmojiSession | null = null
const listeners = new Set<() => void>()

function emit(): void {
    for (const listener of listeners) {
        listener()
    }
}

/** 在光标处打开选择器：坐标取当前选区起点，弹层贴在下方 */
export function openEmojiPicker(editor: Editor): void {
    const coords = editor.view.coordsAtPos(editor.state.selection.from)
    session = { editor, left: coords.left, top: coords.bottom + 4 }
    emit()
}

export function closeEmojiPicker(): void {
    if (session === null) {
        return
    }
    session = null
    emit()
}

export function subscribeEmoji(listener: () => void): () => void {
    listeners.add(listener)
    return (): void => {
        listeners.delete(listener)
    }
}

/** 快照函数：无变化时返回同一引用，useSyncExternalStore 据此跳过渲染 */
export function getEmojiSession(): EmojiSession | null {
    return session
}
