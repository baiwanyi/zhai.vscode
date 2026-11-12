// @vitest-environment jsdom
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { describe, expect, it } from 'vitest'
import { CursorLineExtension } from '@webview/editor/marks/cursorLineExtension'

/**
 * 当前行高亮：验证标记落在光标所在的顶层块上，且同一时刻只有一个块被标记。
 * 复用约定：读编辑器 DOM 上的 class 判断，不依赖行号计数器的渲染结果。
 * 关键约束：行号按顶层块计数，标记若落到段落内层或有多个块，左侧行号会同时点亮好几行。
 */
function createEditor(): Editor {
    return new Editor({
        extensions: [StarterKit, CursorLineExtension],
        content: '<p>第一行</p><p>第二行</p><p>第三行</p>',
    })
}

/** 带标记块的纯文本：没有命中时返回 null */
function cursorLineText(editor: Editor): string | null {
    const element = editor.view.dom.querySelector('.is-cursor-line')
    return element === null ? null : element.textContent
}

describe('CursorLineExtension', () => {
    it('标记光标所在的块', () => {
        const editor = createEditor()
        editor.commands.setTextSelection(1)
        expect(cursorLineText(editor)).toBe('第一行')
        editor.destroy()
    })

    it('光标移动后标记跟着换行', () => {
        const editor = createEditor()
        editor.commands.setTextSelection(1)
        editor.commands.setTextSelection(6)
        expect(cursorLineText(editor)).toBe('第二行')
        editor.destroy()
    })

    it('同一时刻只标记一个块', () => {
        const editor = createEditor()
        editor.commands.setTextSelection(1)
        const target = editor.view.dom.querySelectorAll('.is-cursor-line')
        expect(target).toHaveLength(1)
        editor.destroy()
    })
})
