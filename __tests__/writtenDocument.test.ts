/**
 * 写入文档规范化测试：覆盖章节统一为「# 章节标题 + 章节内容」、模型输出元数据块的剥离，
 * 以及非作品文档与存储根以外路径的原样返回。
 * 复用约定：路径以存储根拼接，仅做字符串判定，不落盘也不触发索引。
 * 关键约束：断言校验落盘全文，确保作品文档不含任何元数据块。
 */
import { describe, expect, it } from 'vitest'
import { resolveStorageRoot } from '../src/modules/common/config'
import { normalizeWrittenDocument } from '../src/modules/press/writtenDocument'

const ROOT = resolveStorageRoot().fsPath

function pathOf(...segments: string[]): string {
    return [ROOT, ...segments].join('\\')
}

const CHAPTER_PATH = pathOf('press', '测试作品', 'Chapters', '01-开篇.md')

describe('章节文档', () => {
    it('没有标题时按文件名补一级标题，正文原样保留', () => {
        const output = normalizeWrittenDocument(CHAPTER_PATH, '正文内容\n')

        expect(output).toBe('# 开篇\n正文内容\n')
    })

    it('模型输出元数据块时剥离，并按文件名统一标题', () => {
        const source = ['---', 'title: 自定义标题', 'summary: 已有简介', '---', '', '正文', ''].join('\n')

        const output = normalizeWrittenDocument(CHAPTER_PATH, source)

        expect(output).toBe('# 开篇\n正文\n')
        expect(output).not.toContain('---')
    })

    it('已有一级标题时保留章纲写入的标题文本', () => {
        const output = normalizeWrittenDocument(CHAPTER_PATH, '# 第1章 开端\n正文\n')

        expect(output).toBe('# 第1章 开端\n正文\n')
    })

    it('模型把章节标题写成二级标题时提升为一级标题', () => {
        const output = normalizeWrittenDocument(CHAPTER_PATH, '## 第1章 开端\n正文\n')

        expect(output).toBe('# 第1章 开端\n正文\n')
        expect(output).not.toContain('## 第1章')
    })

    it('原一级标题之外新增二级标题时只保留一个一级标题', () => {
        const output = normalizeWrittenDocument(CHAPTER_PATH, '# 未命名章节\n\n## 第1章 开端\n\n正文\n')

        expect(output).toBe('# 第1章 开端\n正文\n')
    })

    it('正文里的二级小节标题不受影响', () => {
        const output = normalizeWrittenDocument(CHAPTER_PATH, '# 第1章 开端\n正文\n## 场景一\n细节\n')

        expect(output).toBe('# 第1章 开端\n正文\n## 场景一\n细节\n')
    })
})

describe('README 与其它文档', () => {
    it('README 剥掉模型输出的元数据块，正文原样保留', () => {
        const source = ['---', 'title: 测试作品', 'status: ongoing', '---', '', '# 正文', ''].join('\n')

        const output = normalizeWrittenDocument(pathOf('press', '测试作品', 'README.md'), source)

        expect(output).toBe('# 正文\n')
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
