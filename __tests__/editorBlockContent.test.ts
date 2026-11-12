// @vitest-environment jsdom
import { Editor } from '@tiptap/core'
import Image from '@tiptap/extension-image'
import { TableKit } from '@tiptap/extension-table'
import StarterKit from '@tiptap/starter-kit'
import { describe, expect, it } from 'vitest'
import { isBlankBlock } from '@webview/editor/blocks/blockContent'

/**
 * 空行判定：决定块把手给插入按钮还是拖拽手柄。
 * 复用约定：直接按顶层块断言，不渲染把手组件——把手只消费这个布尔值。
 * 关键约束：只含空格 / 硬换行的行必须算空行；空表格、空代码块、分隔线、图片则不算，
 * 判错会让空行冒出拖拽按钮，或让有内容的块失去拖拽入口。
 */
function blankFlags(content: string): boolean[] {
    const editor = new Editor({
        extensions: [StarterKit, Image, TableKit.configure({ table: { resizable: false } })],
        content,
    })
    const flags: boolean[] = []
    editor.state.doc.forEach((node) => {
        flags.push(isBlankBlock(node))
    })
    editor.destroy()
    return flags
}

describe('isBlankBlock', () => {
    it('空段落算空行', () => {
        expect(blankFlags('<p></p>')).toEqual([true])
    })

    it('只含空格或硬换行的段落算空行', () => {
        expect(blankFlags('<p>   </p><p><br></p>')).toEqual([true, true])
    })

    it('有文字的段落不算空行', () => {
        expect(blankFlags('<p>正文</p>')).toEqual([false])
    })

    it('空引用块算空行，有文字的引用块不算', () => {
        expect(blankFlags('<blockquote><p></p></blockquote><blockquote><p>引文</p></blockquote>')).toEqual([
            true,
            false,
        ])
    })

    it('表格即使全空也不算空行', () => {
        expect(
            blankFlags(
                '<table><tbody><tr><th><p></p></th></tr><tr><td><p></p></td></tr></tbody></table>',
            ),
        ).toEqual([false])
    })

    it('空代码块与分隔线不算空行', () => {
        expect(blankFlags('<pre><code></code></pre><hr>')).toEqual([false, false])
    })

    it('图片块不算空行', () => {
        // Image 是块级节点，段落里放 img 会被拆成「空段落 + 图片块」，这里直接造图片块
        expect(blankFlags('<img src="a.png" alt="图">')).toEqual([false])
    })

    it('空行与有内容行混排时逐块判定', () => {
        expect(blankFlags('<h2>标题</h2><p></p><p>正文</p><p><br></p>')).toEqual([false, true, false, true])
    })
})
