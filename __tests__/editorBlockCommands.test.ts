// @vitest-environment jsdom
import { Editor } from '@tiptap/core'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import UniqueID from '@tiptap/extension-unique-id'
import StarterKit from '@tiptap/starter-kit'
import { describe, expect, it } from 'vitest'
import {
    convertBlock,
    deleteBlock,
    duplicateBlock,
    readBlockLabel,
    readBlockNode,
} from '@webview/editor/blocks/blockCommands'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

/**
 * 块级命令：把手菜单背后的转换、复制与删除。
 * 复用约定：直接调用命令函数并断言文档结构，不渲染菜单——菜单只消费这些返回值。
 * 关键约束：id 必须换新（同 id 会让批注定位串位）；唯一块删除后必须仍有一个空段落；
 * 表格、图片、分隔线这类没有段落内容的块一律拒绝转换，而不是猜一个形态。
 */
function createEditor(content: string): Editor {
    return new Editor({
        extensions: [
            StarterKit,
            TaskList,
            TaskItem.configure({ nested: true }),
            // 与编辑器注册的节点保持一致：id 是复制命令要清空的属性
            UniqueID.configure({
                types: ['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'listItem', 'codeBlock'],
            }),
        ],
        content,
    })
}

/** 读节点上的 id：attrs 是 Record<string, any>，这里统一收窄成可比较的字符串 */
function readNodeId(node: ProseMirrorNode): string | null {
    const value: unknown = node.attrs.id
    return typeof value === 'string' ? value : null
}

/** 第 index 个顶层块的起始位置 */
function blockPos(editor: Editor, index: number): number {
    let pos = 0
    for (let step = 0; step < index; step += 1) {
        pos += editor.state.doc.child(step).nodeSize
    }
    return pos
}

describe('convertBlock', () => {
    it('正文转一级标题：保留加粗 mark', () => {
        const editor = createEditor('<p>正文<strong>加粗</strong></p>')
        const pos = blockPos(editor, 0)
        expect(convertBlock(editor, pos, 'heading1')).toBe(true)
        const node = editor.state.doc.child(0)
        expect(node.type.name).toBe('heading')
        expect(node.attrs.level).toBe(1)
        expect(node.textContent).toBe('正文加粗')
        expect(node.child(1).marks.map((mark) => mark.type.name)).toContain('bold')
        editor.destroy()
    })

    it('列表转正文：每个列表项拆成一个段落', () => {
        const editor = createEditor('<ul><li><p>一</p></li><li><p>二</p></li></ul>')
        expect(convertBlock(editor, blockPos(editor, 0), 'paragraph')).toBe(true)
        expect(editor.state.doc.childCount).toBe(2)
        expect(editor.state.doc.child(0).textContent).toBe('一')
        expect(editor.state.doc.child(1).textContent).toBe('二')
        editor.destroy()
    })

    it('正文转任务列表：结构为 taskList > taskItem > 段落', () => {
        const editor = createEditor('<p>待办</p>')
        expect(convertBlock(editor, blockPos(editor, 0), 'taskList')).toBe(true)
        const list = editor.state.doc.child(0)
        expect(list.type.name).toBe('taskList')
        const item = list.child(0)
        expect(item.type.name).toBe('taskItem')
        expect(item.attrs.checked).toBe(false)
        expect(item.textContent).toBe('待办')
        editor.destroy()
    })

    it('代码块转正文：按行拆成多个段落', () => {
        const editor = createEditor('<pre><code>第一行\n第二行</code></pre>')
        expect(convertBlock(editor, blockPos(editor, 0), 'paragraph')).toBe(true)
        expect(editor.state.doc.childCount).toBe(2)
        expect(editor.state.doc.child(1).textContent).toBe('第二行')
        editor.destroy()
    })

    it('已经是目标类型时不动文档', () => {
        const editor = createEditor('<h2>标题</h2>')
        expect(convertBlock(editor, blockPos(editor, 0), 'heading2')).toBe(false)
        expect(editor.state.doc.child(0).attrs.level).toBe(2)
        editor.destroy()
    })

    it('分隔线这类没有段落内容的块拒绝转换', () => {
        const editor = createEditor('<p>前</p><hr><p>后</p>')
        expect(convertBlock(editor, blockPos(editor, 1), 'paragraph')).toBe(false)
        expect(editor.state.doc.child(1).type.name).toBe('horizontalRule')
        editor.destroy()
    })
})

describe('duplicateBlock', () => {
    it('副本紧跟原块且换成新 id', () => {
        const editor = createEditor('<p>原文</p>')
        const pos = blockPos(editor, 0)
        const sourceId = readNodeId(editor.state.doc.child(0))
        expect(duplicateBlock(editor, pos)).toBe(true)
        expect(editor.state.doc.childCount).toBe(2)
        expect(editor.state.doc.child(1).textContent).toBe('原文')
        expect(readNodeId(editor.state.doc.child(1))).not.toBe(sourceId)
        editor.destroy()
    })

    it('列表内的列表项也换 id：只清顶层会与源块撞车', () => {
        const editor = createEditor('<ul><li><p>项</p></li></ul>')
        const sourceItemId = readNodeId(editor.state.doc.child(0).child(0))
        expect(duplicateBlock(editor, blockPos(editor, 0))).toBe(true)
        expect(readNodeId(editor.state.doc.child(1).child(0))).not.toBe(sourceItemId)
        editor.destroy()
    })
})

describe('deleteBlock', () => {
    it('删除中间块后前后块保留', () => {
        const editor = createEditor('<p>一</p><p>二</p><p>三</p>')
        expect(deleteBlock(editor, blockPos(editor, 1))).toBe(true)
        expect(editor.state.doc.childCount).toBe(2)
        expect(editor.state.doc.child(1).textContent).toBe('三')
        editor.destroy()
    })

    it('删除唯一块后留一个空段落', () => {
        const editor = createEditor('<p>只有一块</p>')
        expect(deleteBlock(editor, 0)).toBe(true)
        expect(editor.state.doc.childCount).toBe(1)
        expect(editor.state.doc.child(0).type.name).toBe('paragraph')
        expect(editor.state.doc.child(0).textContent).toBe('')
        editor.destroy()
    })
})

describe('readBlockLabel', () => {
    it('按块类型给出菜单标题', () => {
        const editor = createEditor(
            '<h3>三</h3><ul><li><p>项</p></li></ul><blockquote><p>引</p></blockquote><pre><code>码</code></pre>',
        )
        expect(readBlockLabel(editor.state.doc.child(0))).toBe('三级标题')
        expect(readBlockLabel(editor.state.doc.child(1))).toBe('无序列表')
        expect(readBlockLabel(editor.state.doc.child(2))).toBe('引用')
        expect(readBlockLabel(editor.state.doc.child(3))).toBe('代码块')
        editor.destroy()
    })

    it('越界位置读不到块', () => {
        const editor = createEditor('<p>正文</p>')
        expect(readBlockNode(editor, -1)).toBeNull()
        expect(readBlockNode(editor, editor.state.doc.content.size)).toBeNull()
        editor.destroy()
    })
})
