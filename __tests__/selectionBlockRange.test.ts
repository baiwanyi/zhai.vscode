// @vitest-environment jsdom
/**
 * 选区块范围单元测试：验证「选中行加入对话」交出的起止块序号是否与宿主快照口径一致。
 * 复用约定：直接构建带 StarterKit 的 Editor，只断言块序号，不涉及宿主换算与网络协议。
 * 关键约束：只选中某块的一部分也必须覆盖整块（宿主按块取整行）；终点落在块末边界时归前一块，
 * 不能串到下一块；空文本块在快照里不存在，序号必须跳过它们。
 */
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { describe, expect, it } from 'vitest'
import { readSelectionBlockRange } from '@webview/editor/blocks/blockQueries'

/** 构造编辑器：content 用 HTML，块序号与 useEditorDocument 的 collectBlocks 同口径 */
function createEditor(content: string): Editor {
    return new Editor({ extensions: [StarterKit], content })
}

describe('readSelectionBlockRange', () => {
    it('只选中单块的一部分，仍只覆盖该块', () => {
        const editor = createEditor('<p>第一段</p><p>第二段</p>')

        const range = readSelectionBlockRange(editor, 2, 3)

        expect(range).toEqual({ startIndex: 0, endIndex: 0 })
        editor.destroy()
    })

    it('跨两块选中时给出首末块序号', () => {
        const editor = createEditor('<p>第一段</p><p>第二段</p>')

        const range = readSelectionBlockRange(editor, 2, 7)

        expect(range).toEqual({ startIndex: 0, endIndex: 1 })
        editor.destroy()
    })

    it('终点落在块末边界时归入前一块，不串到下一块', () => {
        const editor = createEditor('<p>第一段</p><p>第二段</p>')

        // 首块内容起点 1、结束边界 4：整块选中时终点正好在边界上
        const range = readSelectionBlockRange(editor, 1, 4)

        expect(range).toEqual({ startIndex: 0, endIndex: 0 })
        editor.destroy()
    })

    it('跳过空文本块，序号与快照采集口径一致', () => {
        const editor = createEditor('<p>第一段</p><p></p><p>第三段</p>')

        const range = readSelectionBlockRange(editor, 2, editor.state.doc.content.size - 1)

        // 中间空段落不产生快照块：第三段仍是序号 1
        expect(range).toEqual({ startIndex: 0, endIndex: 1 })
        editor.destroy()
    })

    it('终点在文档末尾时覆盖到最后一块', () => {
        const editor = createEditor('<p>第一段</p><p>第二段</p>')

        const range = readSelectionBlockRange(editor, 1, editor.state.doc.content.size)

        expect(range).toEqual({ startIndex: 0, endIndex: 1 })
        editor.destroy()
    })

    it('终点落在文末空段落上时回溯到最后一个非空块', () => {
        const editor = createEditor('<p>第一段</p><p>第二段</p><p></p>')

        // 拖到文末空行：终点位置在空段落上，绝不能退回首块、只剩第一段
        const range = readSelectionBlockRange(editor, 1, editor.state.doc.content.size)

        expect(range).toEqual({ startIndex: 0, endIndex: 1 })
        editor.destroy()
    })

    it('跨空行且终点落在空段落时仍覆盖全部非空块', () => {
        const editor = createEditor('<p>第一段</p><p></p><p>第三段</p><p></p>')

        const range = readSelectionBlockRange(editor, 2, editor.state.doc.content.size)

        expect(range).toEqual({ startIndex: 0, endIndex: 1 })
        editor.destroy()
    })
})
