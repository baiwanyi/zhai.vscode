/**
 * 选区上报：把富文本当前选区（纯文本）节流推给宿主，供 AI 的选区引用与写回定位使用。
 * 复用约定：与标注定位同口径——只上报单块内的整段文字，跨块选区上报空 quote，
 * 因为宿主要在 Markdown 源码里用 quote 定位，跨块文字会因换行与标记对不上而错位。
 * 关键约束：300ms 节流 + 内容未变不重复上报，否则每次方向键都会发一次请求；
 * 空选区只上报 isEmpty、不上报 quote，避免把上一次的选中文案误当成当前选区。
 */
import { useEffect } from 'react'
import { request } from '@shared/utils/bridge'
import type { Editor } from '@tiptap/react'

/** 上报节流：选区拖动时事件极密，按停顿后的一次结果上报足够 */
const REPORT_DELAY_MS = 300

interface SelectionSnapshot {
    quote: string
    blockIndex: number
    isEmpty: boolean
}

/** 解析选区起点所在的顶层块序号：不在任何块内时返回 -1 */
function resolveBlockIndex(editor: Editor, position: number): number {
    const matched: number[] = []
    editor.state.doc.content.forEach((node, offset, index) => {
        if (position >= offset && position < offset + node.nodeSize) {
            matched.push(index)
        }
    })
    return matched[0] ?? -1
}

function readSnapshot(editor: Editor, from: number, to: number): SelectionSnapshot {
    if (from === to) {
        return { quote: '', blockIndex: -1, isEmpty: true }
    }
    const text = editor.state.doc.textBetween(from, to, '\n').trim()
    const isSingleBlock = text.length > 0 && !text.includes('\n')
    return {
        quote: isSingleBlock ? text : '',
        blockIndex: isSingleBlock ? resolveBlockIndex(editor, from) : -1,
        isEmpty: false,
    }
}

export function useEditorSelectionReport(editor: Editor | null, path: string): void {
    useEffect(() => {
        if (editor === null || path === '') {
            return
        }
        let timer: ReturnType<typeof setTimeout> | null = null
        let lastKey = ''

        const send = (): void => {
            const { from, to } = editor.state.selection
            const snapshot = readSnapshot(editor, from, to)
            const key = `${snapshot.isEmpty ? '1' : '0'}#${String(snapshot.blockIndex)}#${snapshot.quote}`
            if (key === lastKey) {
                return
            }
            lastKey = key
            void request('editor/selection', { path, ...snapshot }).catch(() => undefined)
        }

        const handleSelection = (): void => {
            if (timer !== null) {
                clearTimeout(timer)
            }
            timer = setTimeout((): void => {
                timer = null
                send()
            }, REPORT_DELAY_MS)
        }

        editor.on('selectionUpdate', handleSelection)
        return (): void => {
            editor.off('selectionUpdate', handleSelection)
            if (timer !== null) {
                clearTimeout(timer)
            }
        }
    }, [editor, path])
}
