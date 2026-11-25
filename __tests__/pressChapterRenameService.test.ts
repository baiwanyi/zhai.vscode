/**
 * 作品章节重命名测试：覆盖保存时按 H1 同步文件名、保留序号前缀、冲突顺延与索引收敛。
 * 复用约定：虚拟磁盘与编辑器由 vscode 测试桩承接，索引用记录型替身，路径断言统一经 node:path 规范化。
 * 关键约束：只处理章节目录下的 Markdown，其它文件与无一级标题的文档一律跳过。
 */
import * as path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { createTextDocument, readFileContent, resetWorkspaceState, setConfigValue, setFileContent } from './stubs/vscode'
import type { PressChapterRenameIndexer } from '../src/modules/press/chapterRenameService'
import { PressChapterRenameService } from '../src/modules/press/chapterRenameService'

const STORAGE_ROOT = 'd:/vault'
const CHAPTER_DIR = path.join(STORAGE_ROOT, 'press/剑来/Chapters/01-默认卷')

/** 构造索引替身：记录被清理与被重建的路径，断言与笔记重命名同一口径 */
function createRecorder(): {
    indexer: PressChapterRenameIndexer
    removed: string[]
    indexed: string[]
    activeRenamed: string[]
} {
    const removed: string[] = []
    const indexed: string[] = []
    const activeRenamed: string[] = []
    const indexer: PressChapterRenameIndexer = {
        toRelativePath: (uri) => uri.fsPath.replace(/\\/gu, '/').replace(`${STORAGE_ROOT}/`, ''),
        indexFile: (uri) => {
            indexed.push(uri.fsPath)
            return Promise.resolve()
        },
        removeFile: (relativePath) => {
            removed.push(relativePath)
        },
    }
    return { indexer, removed, indexed, activeRenamed }
}

beforeEach(() => {
    resetWorkspaceState()
    setConfigValue('storage.rootPath', STORAGE_ROOT)
})

describe('handleSave', () => {
    it('标题与文件名一致时保留序号前缀且不动作', async () => {
        const recorder = createRecorder()
        const filePath = path.join(CHAPTER_DIR, '01-开端.md')
        setFileContent(filePath, '# 开端\n正文\n')
        const document = createTextDocument(['# 开端', '正文'], filePath)
        const service = new PressChapterRenameService(recorder.indexer, (nextPath) => {
            recorder.activeRenamed.push(nextPath)
        })

        await service.handleSave(document)

        expect(recorder.removed).toEqual([])
        expect(recorder.indexed).toEqual([])
        expect(readFileContent(filePath)).toBe('# 开端\n正文\n')
    })

    it('标题变化后重命名文件并收敛索引，序号前缀保留', async () => {
        const recorder = createRecorder()
        const filePath = path.join(CHAPTER_DIR, '01-未命名章节.md')
        const targetPath = path.join(CHAPTER_DIR, '01-开端.md')
        setFileContent(filePath, '# 开端\n正文\n')
        const document = createTextDocument(['# 开端', '正文'], filePath)
        const service = new PressChapterRenameService(recorder.indexer, (nextPath) => {
            recorder.activeRenamed.push(nextPath)
        })

        await service.handleSave(document)

        expect(readFileContent(filePath)).toBeUndefined()
        expect(readFileContent(targetPath)).toBe('# 开端\n正文\n')
        expect(recorder.removed).toEqual(['press/剑来/Chapters/01-默认卷/01-未命名章节.md'])
        expect(recorder.indexed).toEqual([targetPath])
        expect(recorder.activeRenamed).toEqual(['press/剑来/Chapters/01-默认卷/01-开端.md'])
    })

    it('目标名已被占用时顺延序号', async () => {
        const recorder = createRecorder()
        const filePath = path.join(CHAPTER_DIR, '02-旧标题.md')
        setFileContent(filePath, '# 开端\n正文\n')
        setFileContent(path.join(CHAPTER_DIR, '02-开端.md'), '# 别人的章节\n')
        const document = createTextDocument(['# 开端', '正文'], filePath)
        const service = new PressChapterRenameService(recorder.indexer, () => undefined)

        await service.handleSave(document)

        expect(readFileContent(path.join(CHAPTER_DIR, '02-开端 2.md'))).toBe('# 开端\n正文\n')
        expect(readFileContent(filePath)).toBeUndefined()
    })

    it('旧版 Chapter 目录同样按标题重命名', async () => {
        const recorder = createRecorder()
        const filePath = path.join(STORAGE_ROOT, 'press/剑来/Chapter/01-默认卷/01-旧标题.md')
        const targetPath = path.join(STORAGE_ROOT, 'press/剑来/Chapter/01-默认卷/01-新标题.md')
        setFileContent(filePath, '# 新标题\n正文\n')
        const document = createTextDocument(['# 新标题', '正文'], filePath)
        const service = new PressChapterRenameService(recorder.indexer, () => undefined)

        await service.handleSave(document)

        expect(readFileContent(targetPath)).toBe('# 新标题\n正文\n')
        expect(recorder.removed).toEqual(['press/剑来/Chapter/01-默认卷/01-旧标题.md'])
    })

    it('非章节目录下的文档不处理', async () => {
        const recorder = createRecorder()
        const filePath = path.join(STORAGE_ROOT, 'press/剑来/README.md')
        setFileContent(filePath, '# 另一个标题\n')
        const document = createTextDocument(['# 另一个标题'], filePath)
        const service = new PressChapterRenameService(recorder.indexer, () => undefined)

        await service.handleSave(document)

        expect(recorder.removed).toEqual([])
        expect(readFileContent(filePath)).toBe('# 另一个标题\n')
    })

    it('没有一级标题时保留现有文件名', async () => {
        const recorder = createRecorder()
        const filePath = path.join(CHAPTER_DIR, '01-未命名章节.md')
        setFileContent(filePath, '只有正文\n')
        const document = createTextDocument(['只有正文'], filePath)
        const service = new PressChapterRenameService(recorder.indexer, () => undefined)

        await service.handleSave(document)

        expect(recorder.removed).toEqual([])
        expect(readFileContent(filePath)).toBe('只有正文\n')
    })
})
