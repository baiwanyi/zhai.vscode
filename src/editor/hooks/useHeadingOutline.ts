/**
 * 标题大纲：扫描顶层 heading 节点，供右侧导航渲染与跳转。
 * 复用约定：只读 editor.state.doc 的结构与文本，不碰 DOM；变化监听走 editor 的 transaction（只看 docChanged）。
 * 关键约束：宿主灌正文走 emitUpdate: false，只听 update 会漏掉加载完成那次，导航会一直空着；
 * 空标题（只有样式没有文字）不进入大纲，否则跳转位置会落在节点边界外；
 * 位置取 doc.forEach 的 offset，与 ProseMirror 节点位置同源，跳转时再加 1 才进入文本。
 */
import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/core'
import type { Transaction } from '@tiptap/pm/state'

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
        // 已销毁的实例上注册监听属于未定义行为：卸载与编辑器销毁不一定同拍
        if (editor === null || editor.isDestroyed) {
            return
        }
        const syncItems = (): void => {
            const next = collectHeadings(editor)
            setItems((previous) => (isSameOutline(previous, next) ? previous : next))
        }
        // 正文有变化才重新采集：宿主灌正文用的是 emitUpdate: false，只听 update 会漏掉加载完成这一次
        const handleTransaction = (event: { transaction: Transaction }): void => {
            if (!event.transaction.docChanged) {
                return
            }
            syncItems()
        }
        syncItems()
        editor.on('transaction', handleTransaction)
        return (): void => {
            editor.off('transaction', handleTransaction)
        }
    }, [editor])

    return items
}
