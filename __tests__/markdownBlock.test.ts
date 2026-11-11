/**
 * Markdown 块级插入用例：前后空行补全、行中间断开与片段起始偏移。
 * 复用约定：只调用 common/markdownBlock 的纯函数，上下文用字面量构造，不依赖 vscode 运行时。
 * 关键约束：文档首尾没有上下文时不补空行；光标前后同行有内容时各补「换行 + 空行」；
 * 偏移必须指向引用片段本身，避免插入后选区落到空行上。
 */
import { describe, expect, it } from 'vitest'
import { buildBlockInsertion } from '@modules/common/markdownBlock'

const SNIPPET = '![山间薄雾](@zhai/unsplash/202611/Kq2WnB6x9eA.jpg)'

describe('buildBlockInsertion', () => {
    it('首尾无上下文时不硬造空行', () => {
        const block = buildBlockInsertion({ before: '', after: '', previous: null, next: null }, SNIPPET)

        expect(block.text).toBe(SNIPPET)
        expect(block.start).toBe(0)
    })

    it('行首且上一行有内容时补一个空行', () => {
        const block = buildBlockInsertion({ before: '', after: '', previous: '正文', next: null }, SNIPPET)

        expect(block.text).toBe(`\n${SNIPPET}`)
        expect(block.start).toBe(1)
    })

    it('光标前同行有内容时先换行再空一行', () => {
        const block = buildBlockInsertion({ before: '正文结尾', after: '', previous: null, next: null }, SNIPPET)

        expect(block.text).toBe(`\n\n${SNIPPET}`)
        expect(block.start).toBe(2)
    })

    it('光标后同行有内容时先空一行再续写', () => {
        const block = buildBlockInsertion({ before: '', after: '后续正文', previous: null, next: null }, SNIPPET)

        expect(block.text).toBe(`${SNIPPET}\n\n`)
    })

    it('相邻行已经是空行时不重复补', () => {
        const block = buildBlockInsertion({ before: '', after: '', previous: '', next: '   ' }, SNIPPET)

        expect(block.text).toBe(SNIPPET)
    })

    it('行尾且下一行有内容时补一个空行', () => {
        const block = buildBlockInsertion({ before: '', after: '', previous: null, next: '下一段' }, SNIPPET)

        expect(block.text).toBe(`${SNIPPET}\n`)
    })

    it('行中间插入时同时断开前后', () => {
        const block = buildBlockInsertion(
            { before: '前文', after: '后文', previous: '上一段', next: '下一段' },
            SNIPPET,
        )

        expect(block.text).toBe(`\n\n${SNIPPET}\n\n`)
        expect(block.start).toBe(2)
    })
})
