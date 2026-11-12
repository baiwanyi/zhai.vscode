/**
 * 标题大纲：扫描顶层 heading 节点，供右侧导航渲染与跳转。
 * 复用约定：只读 editor.state.doc 的结构与文本，不碰 DOM；变化监听走 editor 的 update 事件。
 * 关键约束：空标题（只有样式没有文字）不进入大纲，否则跳转位置会落在节点边界外；
 * 位置取 doc.forEach 的 offset，与 ProseMirror 节点位置同源，跳转时再加 1 才进入文本。
 */
import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/core'

export interface HeadingItem {
    /** 标题节点在文档中的位置 */
    pos: number
    /** 标题级别：1-6 */
    level: number
    text: string
}

/** 两份大纲是否一致：内容没变就不触发重渲染 */
function isSameOutline(left: readonly HeadingItem[], right: readonly HeadingItem[]): boolean {
    return (
        left.length === right.length &&
        left.every((item, index) => {
            const other = right[index]
            return (
                other !== undefined && item.pos === other.pos && item.level === other.level && item.text === other.text
            )
        })
    )
}

/** 采集顶层标题：只认 heading 节点，列表与引用里的标题不参与 */
function collectHeadings(editor: Editor): HeadingItem[] {
    const items: HeadingItem[] = []
    editor.state.doc.forEach((node, offset) => {
        if (node.type.name !== 'heading') {
            return
        }
        const text = node.textContent.trim()
        if (text.length === 0) {
            return
        }
        const rawLevel: unknown = node.attrs.level
        items.push({ pos: offset, level: typeof rawLevel === 'number' ? rawLevel : 1, text })
    })
    return items
}

export function useHeadingOutline(editor: Editor | null): HeadingItem[] {
    const [items, setItems] = useState<HeadingItem[]>([])

    useEffect(() => {
        if (editor === null) {
            return
        }
        const update = (): void => {
            const next = collectHeadings(editor)
            setItems((previous) => (isSameOutline(previous, next) ? previous : next))
        }
        update()
        editor.on('update', update)
        return (): void => {
            editor.off('update', update)
        }
    }, [editor])

    return items
}
