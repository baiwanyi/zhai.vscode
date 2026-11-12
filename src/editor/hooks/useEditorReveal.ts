/**
 * 富文本内定位：接收宿主发来的 reveal 消息，选中原文并滚动到可见。
 * 复用约定：与批注装饰同一套定位思路——先按 blockIndex 定位块，再用 quote 在块内查找；
 * 找不到时退化为全文按块搜索，仍找不到就不动（原文已改，由总览页提示）。
 * 关键约束：选中后必须 scrollIntoView，否则用户只看到光标在视口外闪；
 * 只读文档同样允许定位，定位是浏览行为而不是编辑行为。
 */
import { useEffect } from 'react'
import { isEditorRevealPayload } from '@shared/types/editor'
import { onState } from '@shared/utils/bridge'
import type { Editor } from '@tiptap/react'

interface RevealRange {
    from: number
    to: number
}

/**
 * 收集命中区间：blockIndex 为 -1 表示不限块（全文搜索）。
 * 用数组收集而不是闭包变量，避免 TypeScript 对回调内赋值的窄化误判。
 */
function collectRanges(editor: Editor, quote: string, blockIndex: number): RevealRange[] {
    const ranges: RevealRange[] = []
    if (quote.length === 0) {
        return ranges
    }
    editor.state.doc.content.forEach((node, offset, index) => {
        if (!node.isTextblock) {
            return
        }
        if (blockIndex >= 0 && index !== blockIndex) {
            return
        }
        const localStart = node.textContent.indexOf(quote)
        if (localStart < 0) {
            return
        }
        const from = offset + 1 + localStart
        ranges.push({ from, to: from + quote.length })
    })
    return ranges
}

export function useEditorReveal(editor: Editor | null): void {
    useEffect(() => {
        if (editor === null) {
            return
        }
        return onState((message) => {
            if (message.channel !== 'editor' || !isEditorRevealPayload(message.payload)) {
                return
            }
            const { quote, blockIndex } = message.payload
            const range = collectRanges(editor, quote, blockIndex)[0] ?? collectRanges(editor, quote, -1)[0]
            if (range === undefined) {
                return
            }
            editor.chain().focus().setTextSelection(range).scrollIntoView().run()
        })
    }, [editor])
}
