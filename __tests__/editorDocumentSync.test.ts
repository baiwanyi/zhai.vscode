/**
 * 编辑器文档快照与块级回写：验证 frontmatter 分离、块偏移、只读判定与按块替换。
 * 复用约定：直接调用 editorDocService 的纯函数，不触碰 vscode API 与文件系统；
 * 断言全部基于原文切片，确保偏移与 TextDocument 内容同源。
 * 关键约束：非白名单节点必须置只读并渲染为源码块——这条是回写不破坏语法的最后防线。
 */
import { describe, expect, it } from 'vitest'
import { buildBlockEdits, readEditorSnapshot, splitFrontmatter } from '@modules/editor/editorDocService'

const SAMPLE_DOC = [
    '---',
    'title: 第一章',
    'status: draft',
    '---',
    '',
    '开头一段。',
    '',
    '## 小标题',
    '',
    '结尾一段。',
].join('\n')

describe('splitFrontmatter', () => {
    it('分离 frontmatter 并给出正文偏移', () => {
        const result = splitFrontmatter(SAMPLE_DOC)
        expect(result.frontmatter.startsWith('---')).toBe(true)
        expect(result.frontmatter.endsWith('---\n')).toBe(true)
        expect(result.offset).toBe(result.frontmatter.length)
        expect(SAMPLE_DOC.slice(result.offset)).toBe(result.body)
    })

    it('无 frontmatter 时正文即全文', () => {
        expect(splitFrontmatter('只有正文')).toEqual({ frontmatter: '', body: '只有正文', offset: 0 })
    })
})

describe('readEditorSnapshot', () => {
    it('按顶层块切分，偏移可还原原文', async () => {
        const snapshot = await readEditorSnapshot(SAMPLE_DOC, 7, 'press/某作品/01-第一章.md')
        expect(snapshot.version).toBe(7)
        expect(snapshot.blocks).toHaveLength(3)
        expect(snapshot.editable).toBe(true)
        for (const block of snapshot.blocks) {
            expect(SAMPLE_DOC.slice(block.start, block.end).trim().length).toBeGreaterThan(0)
        }
    })

    it('标题块渲染为 h2', async () => {
        const snapshot = await readEditorSnapshot(SAMPLE_DOC, 1, 'x.md')
        const heading = snapshot.blocks[1]
        expect(heading?.html).toContain('<h2>')
    })

    it('含表格时转只读并渲染为源码块', async () => {
        const snapshot = await readEditorSnapshot('| a | b |\n| - | - |\n| 1 | 2 |', 1, 'x.md')
        expect(snapshot.editable).toBe(false)
        expect(snapshot.blocks[0]?.html).toContain('zhai-source-block')
    })

    it('链接段落同样判为只读', async () => {
        const snapshot = await readEditorSnapshot('见[文档](https://example.com)。', 1, 'x.md')
        expect(snapshot.editable).toBe(false)
    })
})

describe('buildBlockEdits', () => {
    it('只产出变化块的替换，偏移取自快照', async () => {
        const snapshot = await readEditorSnapshot('第一段\n\n第二段', 1, 'x.md')
        const target = snapshot.blocks[1]
        expect(target).toBeDefined()
        const edits = await buildBlockEdits(snapshot.blocks, [{ index: 1, html: '<p>改动后的第二段</p>' }])
        expect(edits).toHaveLength(1)
        expect(edits[0]?.start).toBe(target?.start)
        expect(edits[0]?.end).toBe(target?.end)
        expect(edits[0]?.text).toBe('改动后的第二段')
    })

    it('越界下标被忽略，不产生写入', async () => {
        const snapshot = await readEditorSnapshot('只有一段', 1, 'x.md')
        const edits = await buildBlockEdits(snapshot.blocks, [{ index: 9, html: '<p>x</p>' }])
        expect(edits).toHaveLength(0)
    })

    it('多块变更按偏移倒序排列，便于从后往前应用', async () => {
        const snapshot = await readEditorSnapshot('第一段\n\n第二段\n\n第三段', 1, 'x.md')
        const edits = await buildBlockEdits(snapshot.blocks, [
            { index: 0, html: '<p>改一</p>' },
            { index: 2, html: '<p>改三</p>' },
        ])
        expect(edits).toHaveLength(2)
        expect(edits[0]?.start).toBeGreaterThan(edits[1]?.start ?? 0)
    })
})
