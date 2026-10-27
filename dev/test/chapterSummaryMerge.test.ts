/**
 * 章节摘要回填单元测试：覆盖 Frontmatter 只补空不覆盖、缺失键追加、无 Frontmatter 不碰、
 * 特殊字符序列化，以及按章节清单路径与摘要表序号配对写盘的编排（含脏文档与读写失败）。
 * 复用约定：素材文件名直接取 MATERIAL_FILE_NAMES，断言用生产代码的 splitFrontmatter 读回；
 * 虚拟磁盘、虚拟目录与可打开文档由 vscode 测试桩承接，不触达真实文件系统。
 * 关键约束：路径一律经 node:path 规范化，与实现里的 buildStorageUri 走同一套分隔符规则。
 */
import * as path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
    readFileContent,
    registerDirtyTextDocument,
    resetWorkspaceState,
    setConfigValue,
    setFileContent,
} from './stubs/vscode'
import type { ProjectIndexer } from '../../src/modules/press/projectService'
import { splitFrontmatter } from '../../src/modules/common/db/fileMeta'
import { mergeChapterSummaries, mergeChapterSummaryFrontmatter } from '../../src/modules/press/chapterSummaryMerge'
import { MATERIAL_FILE_NAMES } from '../../src/modules/press/importAnalysis'

const STORAGE_ROOT = 'd:/vault'
const DIR_PATH = 'press/剑来'
const CHAPTER_A = 'press/剑来/Chapters/01-卷1/01-第一章 少年.md'
const CHAPTER_B = 'press/剑来/Chapters/01-卷1/02-第二章 入山.md'
const CHAPTER_C = 'press/剑来/Chapters/01-卷1/03-第三章 出山.md'

/** 章节在虚拟磁盘上的绝对路径 */
function toDiskPath(relativePath: string): string {
    return path.join(STORAGE_ROOT, relativePath)
}

/** 作品内素材文件的绝对路径：文件名取生产常量，避免改名后测试从错误的路径读空 */
function toMaterialPath(relativePath: string): string {
    return path.join(STORAGE_ROOT, DIR_PATH, ...relativePath.split('/'))
}

/** 构造一份章节文档：summary 传空串表示键存在但值为空，与新建章节的模板一致 */
function buildChapter(title: string, summary = ''): string {
    const summaryLine = summary.length > 0 ? `summary: ${summary}` : 'summary:'
    return [
        '---',
        `title: ${title}`,
        'status: draft',
        summaryLine,
        'characters: []',
        'goldenFingers: []',
        'wordGoal: 0',
        '---',
        '',
        '他走了出去。',
    ].join('\n')
}

/** 构造记录索引调用的替身 */
function createIndexer(): { indexer: ProjectIndexer; indexed: string[] } {
    const indexed: string[] = []
    const indexer: ProjectIndexer = {
        indexFile: (uri) => {
            indexed.push(uri.fsPath)
            return Promise.resolve()
        },
        removeFilesUnder: () => undefined,
        removeFile: () => undefined,
    }
    return { indexer, indexed }
}

/** 铺好素材表：三章登记，摘要齐全 */
function seedMaterials(): void {
    setFileContent(
        toMaterialPath(MATERIAL_FILE_NAMES.index),
        [
            '序号\t卷\t标题\t字数\t路径',
            `1\t01-卷1\t第一章 少年\t5\t${CHAPTER_A}`,
            `2\t01-卷1\t第二章 入山\t5\t${CHAPTER_B}`,
            `3\t01-卷1\t第三章 出山\t5\t${CHAPTER_C}`,
        ].join('\n'),
    )
    setFileContent(
        toMaterialPath(MATERIAL_FILE_NAMES.summaries),
        [
            '序号\t摘要\t钩子\t张力\t关键节点\t出场',
            '1\t少年登山，遇雨。\t悬念\t3\t\t',
            '2\t入山受阻。\t冲突\t4\t\t',
            '3\t出山复仇。\t转折\t5\t\t',
        ].join('\n'),
    )
}

beforeEach(() => {
    resetWorkspaceState()
    setConfigValue('storage.rootPath', STORAGE_ROOT)
})

describe('mergeChapterSummaryFrontmatter', () => {
    it('summary 为空时写入摘要，正文与其它键原样保留', () => {
        const merged = mergeChapterSummaryFrontmatter(buildChapter('第一章 少年'), '少年登山，遇雨。')
        expect(merged).not.toBeNull()
        const { frontmatter, body } = splitFrontmatter(merged ?? '')
        expect(frontmatter).toContain('summary: 少年登山，遇雨。')
        expect(frontmatter).toContain('title: 第一章 少年')
        expect(frontmatter).toContain('wordGoal: 0')
        expect(body).toContain('他走了出去。')
    })

    it('已有摘要时不做覆盖', () => {
        expect(mergeChapterSummaryFrontmatter(buildChapter('第一章 少年', '旧摘要'), '新摘要')).toBeNull()
    })

    it('缺少 summary 键时追加到 Frontmatter 末尾', () => {
        const content = ['---', 'title: 第一章 少年', 'status: draft', '---', '', '正文。'].join('\n')
        const merged = mergeChapterSummaryFrontmatter(content, '少年登山。')
        expect(merged).not.toBeNull()
        expect(splitFrontmatter(merged ?? '').frontmatter).toContain('summary: 少年登山。')
    })

    it('没有 Frontmatter 的文档不改写', () => {
        expect(mergeChapterSummaryFrontmatter('只有正文。', '摘要')).toBeNull()
    })

    it('空摘要不写入', () => {
        expect(mergeChapterSummaryFrontmatter(buildChapter('第一章 少年'), '   ')).toBeNull()
    })

    it('含半角冒号与换行的摘要按 YAML 规则加引号并折叠空白', () => {
        const merged = mergeChapterSummaryFrontmatter(buildChapter('第一章 少年'), '他说: 走吧\n然后离开')
        expect(merged).toContain('summary: "他说: 走吧 然后离开"')
    })
})

describe('mergeChapterSummaries', () => {
    it('按素材路径回填摘要：已有序章跳过，读取失败计入失败', async () => {
        seedMaterials()
        setFileContent(toDiskPath(CHAPTER_A), buildChapter('第一章 少年'))
        setFileContent(toDiskPath(CHAPTER_B), buildChapter('第二章 入山', '旧摘要'))
        const { indexer, indexed } = createIndexer()
        const result = await mergeChapterSummaries({
            dirPath: DIR_PATH,
            chapterPaths: [CHAPTER_A, CHAPTER_B, CHAPTER_C, 'press/剑来/Chapters/01-卷1/09-新章.md'],
            indexer,
        })
        expect(result.updated).toBe(1)
        expect(result.skipped).toBe(1)
        expect(result.failed).toBe(1)
        expect(readFileContent(toDiskPath(CHAPTER_A))).toContain('summary: 少年登山，遇雨。')
        expect(readFileContent(toDiskPath(CHAPTER_B))).toContain('summary: 旧摘要')
        expect(indexed).toEqual([toDiskPath(CHAPTER_A)])
    })

    it('没有摘要素材时给出提示且不改动章节', async () => {
        setFileContent(toDiskPath(CHAPTER_A), buildChapter('第一章 少年'))
        const { indexer, indexed } = createIndexer()
        const result = await mergeChapterSummaries({
            dirPath: DIR_PATH,
            chapterPaths: [CHAPTER_A],
            indexer,
        })
        expect(result.updated).toBe(0)
        expect(result.message).toContain('尚未生成章节摘要')
        expect(indexed).toEqual([])
        expect(readFileContent(toDiskPath(CHAPTER_A))).toContain('summary:')
    })

    it('素材路径与当前章节对不上时如实说明', async () => {
        seedMaterials()
        const { indexer, indexed } = createIndexer()
        const result = await mergeChapterSummaries({
            dirPath: DIR_PATH,
            chapterPaths: ['press/剑来/Chapters/01-卷1/08-改过名的章.md'],
            indexer,
        })
        expect(result.updated).toBe(0)
        expect(result.message).toContain('对不上')
        expect(indexed).toEqual([])
    })

    it('编辑器里有未保存修改的章节跳过', async () => {
        seedMaterials()
        setFileContent(toDiskPath(CHAPTER_A), buildChapter('第一章 少年'))
        registerDirtyTextDocument(toDiskPath(CHAPTER_A), ['---', 'title: 第一章 少年', '---'])
        const { indexer, indexed } = createIndexer()
        const result = await mergeChapterSummaries({
            dirPath: DIR_PATH,
            chapterPaths: [CHAPTER_A],
            indexer,
        })
        expect(result.updated).toBe(0)
        expect(result.skipped).toBe(1)
        expect(indexed).toEqual([])
    })
})
