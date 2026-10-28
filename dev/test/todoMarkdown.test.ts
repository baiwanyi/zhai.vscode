/**
 * 待办 Markdown 编解码的单测：覆盖解析口径、勾选改写、追加与删除的行级操作。
 * 复用约定：只测纯函数，不触碰 vscode 桩；文本一律以带尾换行的完整文档形态断言。
 * 关键约束：写回必须只动目标行，其余行（含说明文字与空行）逐字保留，这是用户手改文件的前提。
 */
import { describe, expect, it } from 'vitest'
import {
    appendTodoLines,
    buildTodoListContent,
    joinTodoLines,
    normalizeTodoText,
    parseTodoMarkdown,
    removeTodoLine,
    replaceHeading,
    splitTodoLines,
    toggleTodoLine,
} from '../../src/modules/todo/todoMarkdown'

describe('待办解析', () => {
    it('识别三种列表符号与大小写勾选，行号按原文件计', () => {
        const content = ['# 待办 1', '', '- [ ] 第一条', '* [x] 第二条', '+ [X] 第三条', '  - [ ] 缩进条目'].join('\n')

        const entries = parseTodoMarkdown(content)

        expect(entries).toEqual([
            { line: 2, text: '第一条', done: false },
            { line: 3, text: '第二条', done: true },
            { line: 4, text: '第三条', done: true },
            { line: 5, text: '缩进条目', done: false },
        ])
    })

    it('忽略说明文字与空文本条目', () => {
        const content = ['# 待办 1', '', '说明：本周重点', '- [ ]', '- [ ] 有内容'].join('\n')

        const entries = parseTodoMarkdown(content)

        expect(entries).toEqual([{ line: 4, text: '有内容', done: false }])
    })
})

describe('待办改写', () => {
    it('勾选只替换方括号标记，缩进与文本保持原样', () => {
        const lines = ['# 待办 1', '', '- [ ] 甲', '  * [ ] 乙']

        const next = toggleTodoLine(lines, 2, true)

        expect(next).toEqual(['# 待办 1', '', '- [x] 甲', '  * [ ] 乙'])
    })

    it('取消勾选把标记写回空格', () => {
        const next = toggleTodoLine(['- [x] 甲'], 0, false)

        expect(next).toEqual(['- [ ] 甲'])
    })

    it('追加条目时在标题与列表之间补一个空行', () => {
        const next = appendTodoLines(['# 待办 1'], ['甲', '乙'])

        expect(joinTodoLines(next)).toBe('# 待办 1\n\n- [ ] 甲\n- [ ] 乙\n')
    })

    it('删除只剔除目标行，说明文字与相邻条目不动', () => {
        const lines = ['# 待办 1', '', '说明：本周重点', '- [ ] 甲', '- [ ] 乙']

        const next = removeTodoLine(lines, 3)

        expect(joinTodoLines(next)).toBe('# 待办 1\n\n说明：本周重点\n- [ ] 乙\n')
    })

    it('重命名只改首个一级标题，正文不动', () => {
        const next = replaceHeading(['# 待办 1', '', '- [ ] 甲'], '本周待办')

        expect(next).toEqual(['# 本周待办', '', '- [ ] 甲'])
    })

    it('没有一级标题时保持原样，不凭空插入标题行', () => {
        expect(replaceHeading(['- [ ] 甲'], '本周待办')).toEqual(['- [ ] 甲'])
    })
})

describe('文本与文件口径', () => {
    it('原文压缩成单行并去首尾空白', () => {
        expect(normalizeTodoText('  写\n方案  ')).toBe('写 方案')
    })

    it('超长文本按上限截断', () => {
        const text = normalizeTodoText('字'.repeat(600))

        expect(text).toHaveLength(500)
    })

    it('读取时去 BOM、统一换行并丢弃末尾空行', () => {
        expect(splitTodoLines('\uFEFF# 待办 1\r\n\r\n- [ ] 甲\r\n')).toEqual(['# 待办 1', '', '- [ ] 甲'])
    })

    it('新建清单只写一级标题并以换行结束', () => {
        expect(buildTodoListContent('待办 1')).toBe('# 待办 1\n')
        expect(joinTodoLines([])).toBe('')
    })
})
