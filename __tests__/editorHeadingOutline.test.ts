// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { describe, expect, it } from 'vitest'
import { useHeadingOutline } from '@webview/editor/hooks/useHeadingOutline'

/**
 * 右侧标题导航的数据源：验证标题采集顺序、层级与跳转位置。
 * 复用约定：直接挂载 hook，不渲染导航组件——组件只负责展示，逻辑全在这里。
 * 关键约束：空标题必须被过滤，否则跳转位置会落在节点边界外；pos 必须能直接定位到标题文本。
 */
function createEditor(content: string): Editor {
    return new Editor({ extensions: [StarterKit], content })
}

describe('useHeadingOutline', () => {
    it('按顺序收集顶层标题与层级', () => {
        const editor = createEditor('<h1>第一章</h1><p>正文</p><h2>小节</h2><h3>细目</h3>')
        const { result } = renderHook(() => useHeadingOutline(editor))
        expect(result.current.map((item) => [item.level, item.text])).toEqual([
            [1, '第一章'],
            [2, '小节'],
            [3, '细目'],
        ])
        editor.destroy()
    })

    it('空标题不进入大纲', () => {
        const editor = createEditor('<h1></h1><p>正文</p><h2>有内容</h2>')
        const { result } = renderHook(() => useHeadingOutline(editor))
        expect(result.current).toHaveLength(1)
        expect(result.current[0]?.text).toBe('有内容')
        editor.destroy()
    })

    it('位置可直接定位到标题文本', () => {
        const editor = createEditor('<p>前言</p><h1>标题</h1>')
        const { result } = renderHook(() => useHeadingOutline(editor))
        const first = result.current[0]
        expect(first).toBeDefined()
        const pos = first?.pos ?? -1
        expect(editor.state.doc.textBetween(pos + 1, pos + 3)).toBe('标题')
        editor.destroy()
    })

    it('没有标题时返回空数组', () => {
        const editor = createEditor('<p>只有正文</p>')
        const { result } = renderHook(() => useHeadingOutline(editor))
        expect(result.current).toHaveLength(0)
        editor.destroy()
    })
})
