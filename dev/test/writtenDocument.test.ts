/**
 * 写入文档规范化测试：覆盖章节与 README 的 Frontmatter 补齐，以及非作品文档的原样返回。
 * 复用约定：路径以存储根拼接，仅做字符串判定，不落盘也不触发索引。
 * 关键约束：断言只看关键行是否存在，不断言整体空白细节，避免格式微调导致误报。
 */
import { describe, expect, it } from 'vitest'
import { resolveStorageRoot } from '../../src/modules/common/config'
import { normalizeWrittenDocument } from '../../src/modules/press/writtenDocument'

const ROOT = resolveStorageRoot().fsPath

function pathOf(...segments: string[]): string {
    return [ROOT, ...segments].join('\\')
}

describe('章节文档', () => {
    it('没有 Frontmatter 时补齐章节字段', () => {
        const output = normalizeWrittenDocument(pathOf('press', '测试作品', 'Chapters', '01-开篇.md'), '正文内容\n')
        expect(output.startsWith('---')).toBe(true)
        expect(output).toContain('title: 开篇')
        expect(output).toContain('status: draft')
        expect(output).toContain('characters: []')
        expect(output).toContain('正文内容')
    })

    it('已有字段保持不变，只补缺失项', () => {
        const source = ['---', 'title: 自定义标题', 'summary: 已有简介', '---', '', '正文', ''].join('\n')
        const output = normalizeWrittenDocument(pathOf('press', '测试作品', 'Chapters', '01-开篇.md'), source)
        expect(output).toContain('title: 自定义标题')
        expect(output).toContain('summary: 已有简介')
        expect(output).toContain('goldenFingers: []')
        expect(output).not.toContain('title: 开篇')
    })
})

describe('README 与其它文档', () => {
    it('README 补齐作品字段', () => {
        const output = normalizeWrittenDocument(pathOf('press', '测试作品', 'README.md'), '# 正文\n')
        expect(output).toContain('title: 测试作品')
        expect(output).toContain('status: ongoing')
    })

    it('设定文档原样返回', () => {
        const source = '# 世界观\n\n内容\n'
        expect(normalizeWrittenDocument(pathOf('press', '测试作品', '世界观.md'), source)).toBe(source)
    })

    it('存储根以外的路径原样返回', () => {
        const source = '# 外部\n'
        expect(normalizeWrittenDocument('C:\\外部\\a.md', source)).toBe(source)
    })
})
