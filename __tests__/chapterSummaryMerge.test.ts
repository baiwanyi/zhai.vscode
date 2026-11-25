/**
 * 章节摘要回填单元测试：覆盖大纲「计划梗概」只补空不覆盖、缺段补建、章号对不上跳过，
 * 以及按素材路径取章号后一次写回大纲并重建索引的编排（含脏文档）。
 * 复用约定：素材文件名直接取 MATERIAL_FILE_NAMES，断言用生产代码的 readOutlineChapterBlocks 读回；
 * 虚拟磁盘与可打开文档由 vscode 测试桩承接，不触达真实文件系统。
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
import type { ProjectIndexer } from '../src/modules/press/projectService'
import { mergeChapterSummaries } from '../src/modules/press/chapterSummaryMerge'
import { MATERIAL_FILE_NAMES } from '../src/modules/press/importAnalysis'
import { mergeChapterSummaryIntoOutline, readOutlineChapterBlocks } from '../src/modules/press/outlineSync'

const STORAGE_ROOT = 'd:/vault'
const DIR_PATH = 'press/剑来'
const OUTLINE_PATH = 'press/剑来/大纲.md'
const CHAPTER_A = 'press/剑来/Chapters/01-卷1/01-第一章 少年.md'
const CHAPTER_B = 'press/剑来/Chapters/01-卷1/02-第二章 入山.md'
const CHAPTER_C = 'press/剑来/Chapters/01-卷1/03-第三章 出山.md'

/** 大纲在虚拟磁盘上的绝对路径 */
function toDiskPath(relativePath: string): string {
    return path.join(STORAGE_ROOT, relativePath)
}

/** 作品内素材文件的绝对路径：文件名取生产常量，避免改名后测试从错误的路径读空 */
function toMaterialPath(relativePath: string): string {
    return path.join(STORAGE_ROOT, DIR_PATH, ...relativePath.split('/'))
}

/** 构造大纲：三个章块，梗概按传入内容填充，空串表示尚未回填 */
function buildOutline(summaries: readonly string[] = ['', '', '']): string {
    const lines = ['# 大纲', '', '## 章节内容', '', '### 卷1', '']
    summaries.forEach((summary, index) => {
        lines.push(`#### 第${String(index + 1)}章`, '', '- 状态：待写', '', '##### 计划梗概', '')
        if (summary.length > 0) {
            lines.push(summary, '')
        }
    })
    return lines.join('\n')
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

describe('mergeChapterSummaryIntoOutline', () => {
    it('梗概为空时写入摘要，其它章块原样保留', () => {
        const merged = mergeChapterSummaryIntoOutline(buildOutline(), 1, '少年登山，遇雨。')
        expect(merged).not.toBeNull()
        const blocks = readOutlineChapterBlocks(merged ?? '')
        expect(blocks[0]?.summary).toBe('少年登山，遇雨。')
        expect(blocks[1]?.summary).toBe('')
    })

    it('已有梗概时不做覆盖', () => {
        expect(mergeChapterSummaryIntoOutline(buildOutline(['旧摘要']), 1, '新摘要')).toBeNull()
    })

    it('缺少计划梗概段时补建在章块末尾', () => {
        const outline = ['# 大纲', '', '## 章节内容', '', '### 卷1', '', '#### 第1章', '', '- 状态：待写', ''].join('\n')
        const merged = mergeChapterSummaryIntoOutline(outline, 1, '少年登山。')
        expect(merged).toContain('##### 计划梗概')
        expect(readOutlineChapterBlocks(merged ?? '')[0]?.summary).toBe('少年登山。')
    })

    it('章号对不上时返回 null', () => {
        expect(mergeChapterSummaryIntoOutline(buildOutline(), 9, '摘要')).toBeNull()
        expect(mergeChapterSummaryIntoOutline('只有正文。', 1, '摘要')).toBeNull()
    })

    it('空摘要不写入', () => {
        expect(mergeChapterSummaryIntoOutline(buildOutline(), 1, '   ')).toBeNull()
    })

    it('含半角冒号与换行的摘要折叠为单行', () => {
        const merged = mergeChapterSummaryIntoOutline(buildOutline(), 1, '他说: 走吧\n然后离开')
        expect(readOutlineChapterBlocks(merged ?? '')[0]?.summary).toBe('他说: 走吧 然后离开')
    })
})

describe('mergeChapterSummaries', () => {
    it('按素材回填大纲：已有序章跳过，路径对不上跳过，索引只触发一次', async () => {
        seedMaterials()
        setFileContent(toDiskPath(OUTLINE_PATH), buildOutline(['', '旧摘要', '']))
        const { indexer, indexed } = createIndexer()
        const result = await mergeChapterSummaries({
            dirPath: DIR_PATH,
            chapterPaths: [CHAPTER_A, CHAPTER_B, CHAPTER_C, 'press/剑来/Chapters/01-卷1/09-新章.md'],
            indexer,
        })
        expect(result.updated).toBe(2)
        expect(result.skipped).toBe(1)
        expect(result.failed).toBe(0)
        const blocks = readOutlineChapterBlocks(readFileContent(toDiskPath(OUTLINE_PATH)) ?? '')
        expect(blocks[0]?.summary).toBe('少年登山，遇雨。')
        expect(blocks[1]?.summary).toBe('旧摘要')
        expect(blocks[2]?.summary).toBe('出山复仇。')
        expect(indexed).toEqual([toDiskPath(OUTLINE_PATH)])
    })

    it('没有摘要素材时给出提示且不改动大纲', async () => {
        setFileContent(toDiskPath(OUTLINE_PATH), buildOutline())
        const { indexer, indexed } = createIndexer()
        const result = await mergeChapterSummaries({
            dirPath: DIR_PATH,
            chapterPaths: [CHAPTER_A],
            indexer,
        })
        expect(result.updated).toBe(0)
        expect(result.message).toContain('尚未生成章节摘要')
        expect(indexed).toEqual([])
        expect(readOutlineChapterBlocks(readFileContent(toDiskPath(OUTLINE_PATH)) ?? '')[0]?.summary).toBe('')
    })

    it('素材路径与当前章节对不上时如实说明', async () => {
        seedMaterials()
        setFileContent(toDiskPath(OUTLINE_PATH), buildOutline())
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

    it('大纲在编辑器里有未保存修改时整批跳过', async () => {
        seedMaterials()
        setFileContent(toDiskPath(OUTLINE_PATH), buildOutline())
        registerDirtyTextDocument(toDiskPath(OUTLINE_PATH), buildOutline().split('\n'))
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
