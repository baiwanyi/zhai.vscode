/**
 * projectService / projectFactory 单元测试：覆盖作品名校验、骨架落盘与索引触发、重名拒绝与打开路径校验。
 * 虚拟磁盘、目录与可打开文档由 vscode 测试桩承接，不触达真实文件系统；
 * 路径断言统一用 node:path 规范化，与实现一样规避分隔符差异。
 */
import * as path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
    hasDirectory,
    readFileContent,
    readOpenedDocumentPaths,
    registerTextDocument,
    resetWorkspaceState,
    setConfigValue,
    setFileContent,
} from '@/__test__/stubs/vscode'
import type { ProjectIndexer } from '../modules/press/projectService'
import { validateProjectName } from '../modules/press/projectFactory'
import { createChapter, createProject, openChapterByPath, openProjectByDir } from '../modules/press/projectService'

const STORAGE_ROOT = 'd:/vault'

/** 构造记录索引调用的替身，返回被索引的绝对路径列表供断言 */
function createIndexer(): { indexer: ProjectIndexer; indexed: string[] } {
    const indexed: string[] = []
    const indexer: ProjectIndexer = {
        indexFile: (uri) => {
            indexed.push(uri.fsPath)
            return Promise.resolve()
        },
    }
    return { indexer, indexed }
}

beforeEach(() => {
    resetWorkspaceState()
    setConfigValue('storage.rootPath', STORAGE_ROOT)
})

describe('validateProjectName', () => {
    it('接受中文名与含空格的常规名', () => {
        expect(validateProjectName('剑来')).toBeNull()
        expect(validateProjectName('凡人修仙传 第一部')).toBeNull()
        expect(validateProjectName('conan')).toBeNull()
    })

    it('拒绝空名与超长名', () => {
        expect(validateProjectName('')).toBe('作品名不能为空')
        expect(validateProjectName('作'.repeat(61))).toBe('作品名不能超过 60 个字符')
    })

    it('拒绝路径分隔符、盘符与非法字符', () => {
        for (const name of ['a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b']) {
            expect(validateProjectName(name)).toBe('作品名不能包含 \\ / : * ? " < > | 等非法字符')
        }
    })

    it('拒绝控制字符与 . / ..', () => {
        expect(validateProjectName('剑\u0007来')).toBe('作品名不能包含 \\ / : * ? " < > | 等非法字符')
        expect(validateProjectName('.')).toBe('作品名不能为 . 或 ..')
        expect(validateProjectName('..')).toBe('作品名不能为 . 或 ..')
    })

    it('拒绝以空格开头或以空格、点结尾的名字', () => {
        const reason = '作品名不能以空格开头，也不能以空格或点结尾'
        expect(validateProjectName(' 剑来')).toBe(reason)
        expect(validateProjectName('剑来 ')).toBe(reason)
        expect(validateProjectName('剑来.')).toBe(reason)
    })

    it('拒绝系统保留名及其带扩展名的变体', () => {
        expect(validateProjectName('CON')).toBe('作品名不能使用系统保留名：CON')
        expect(validateProjectName('con.md')).toBe('作品名不能使用系统保留名：con.md')
        expect(validateProjectName('LPT9')).toBe('作品名不能使用系统保留名：LPT9')
    })
})

describe('createProject', () => {
    it('生成骨架目录与四份文档，并逐份纳入索引', async () => {
        const { indexer, indexed } = createIndexer()
        const created = await createProject(indexer, { name: '剑来', category: '玄幻' })

        expect(created.dirPath).toBe('press/剑来')
        expect(created.title).toBe('剑来')
        const directory = path.join(STORAGE_ROOT, 'press', '剑来')
        expect(hasDirectory(directory)).toBe(true)
        expect(hasDirectory(path.join(directory, 'Chapter'))).toBe(true)
        expect(readFileContent(path.join(directory, 'README.md'))).toContain('title: 剑来')
        expect(readFileContent(path.join(directory, 'README.md'))).toContain('category: 玄幻')
        expect(readFileContent(path.join(directory, '大纲.md'))).toContain('# 大纲')
        expect(readFileContent(path.join(directory, '角色设定.md'))).toContain('# 角色设定')
        expect(readFileContent(path.join(directory, '设定.md'))).toContain('# 设定')
        expect(indexed).toEqual([
            path.join(directory, 'README.md'),
            path.join(directory, '大纲.md'),
            path.join(directory, '角色设定.md'),
            path.join(directory, '设定.md'),
        ])
    })

    it('作品名去首尾空格后再落盘', async () => {
        const { indexer } = createIndexer()
        const created = await createProject(indexer, { name: ' 剑来 ', category: '其他' })

        expect(created.dirPath).toBe('press/剑来')
        expect(hasDirectory(path.join(STORAGE_ROOT, 'press', '剑来'))).toBe(true)
    })

    it('同名作品已存在时拒绝创建且不重复索引', async () => {
        const { indexer, indexed } = createIndexer()
        await createProject(indexer, { name: '剑来', category: '玄幻' })
        const countAfterFirst = indexed.length

        await expect(createProject(indexer, { name: '剑来', category: '都市' })).rejects.toThrow('作品已存在：剑来')
        expect(indexed).toHaveLength(countAfterFirst)
    })

    it('作品名非法时不触碰文件系统', async () => {
        const { indexer, indexed } = createIndexer()

        await expect(createProject(indexer, { name: '../evil', category: '其他' })).rejects.toThrow('作品名不能包含')
        expect(hasDirectory(path.join(STORAGE_ROOT, 'press', '..', 'evil'))).toBe(false)
        expect(indexed).toEqual([])
    })
})

describe('openProjectByDir', () => {
    it('按作品目录打开 README.md', async () => {
        const target = path.join(STORAGE_ROOT, 'press', '剑来', 'README.md')
        registerTextDocument(target, ['# 剑来'])

        await openProjectByDir('press/剑来')

        expect(readOpenedDocumentPaths()).toEqual([target])
    })

    it('拒绝非 press 模块或层级不符的目录', async () => {
        await expect(openProjectByDir('press')).rejects.toThrow('作品路径非法：press')
        await expect(openProjectByDir('notes/a')).rejects.toThrow('作品路径非法：notes/a')
        await expect(openProjectByDir('press/剑来/Chapter')).rejects.toThrow('作品路径非法：press/剑来/Chapter')
    })

    it('拒绝上跳片段，不触达编辑器', async () => {
        await expect(openProjectByDir('press/../secret')).rejects.toThrow('作品路径非法')
        expect(readOpenedDocumentPaths()).toEqual([])
    })

    it('README 缺失时把读取错误上抛', async () => {
        await expect(openProjectByDir('press/雪中')).rejects.toThrow('ENOENT')
        expect(readOpenedDocumentPaths()).toEqual([])
    })
})

describe('createChapter', () => {
    it('无章节时在 Chapter/ 根创建首章并立即索引', async () => {
        const { indexer, indexed } = createIndexer()

        const created = await createChapter(indexer, { dirPath: 'press/剑来', chapterPaths: [] })

        expect(created.path).toBe('press/剑来/Chapter/01-未命名章节.md')
        expect(created.title).toBe('01 未命名章节')
        expect(created.volume).toBe('')
        expect(hasDirectory(path.join(STORAGE_ROOT, 'press', '剑来', 'Chapter'))).toBe(true)
        expect(readFileContent(path.join(STORAGE_ROOT, created.path))).toContain('title: 01 未命名章节')
        expect(indexed).toEqual([path.join(STORAGE_ROOT, created.path)])
    })

    it('已有章节时按最大序号顺延', async () => {
        const { indexer } = createIndexer()

        const created = await createChapter(indexer, {
            dirPath: 'press/剑来',
            chapterPaths: ['press/剑来/Chapter/01-初见.md', 'press/剑来/Chapter/07-再会.md'],
        })

        expect(created.path).toBe('press/剑来/Chapter/08-未命名章节.md')
        expect(created.title).toBe('08 未命名章节')
    })

    it('存在分卷时追加到序号最大的卷', async () => {
        const { indexer } = createIndexer()

        const created = await createChapter(indexer, {
            dirPath: 'press/剑来',
            chapterPaths: [
                'press/剑来/Chapter/09-根目录章节.md',
                'press/剑来/Chapter/01-第一卷/01-初遇.md',
                'press/剑来/Chapter/02-第二卷/03-远行.md',
            ],
        })

        expect(created.path).toBe('press/剑来/Chapter/02-第二卷/04-未命名章节.md')
        expect(created.volume).toBe('第二卷')
    })

    it('目标文件名已存在时递增序号且不覆盖', async () => {
        const { indexer } = createIndexer()
        const occupied = path.join(STORAGE_ROOT, 'press', '剑来', 'Chapter', '01-未命名章节.md')
        setFileContent(occupied, '既有内容')

        const created = await createChapter(indexer, { dirPath: 'press/剑来', chapterPaths: [] })

        expect(created.path).toBe('press/剑来/Chapter/02-未命名章节.md')
        expect(readFileContent(occupied)).toBe('既有内容')
    })

    it('作品目录非法时拒绝落盘', async () => {
        const { indexer, indexed } = createIndexer()

        await expect(createChapter(indexer, { dirPath: 'notes/剑来', chapterPaths: [] })).rejects.toThrow(
            '作品路径非法',
        )
        await expect(createChapter(indexer, { dirPath: 'press', chapterPaths: [] })).rejects.toThrow('作品路径非法')
        expect(indexed).toEqual([])
    })
})

describe('openChapterByPath', () => {
    it('打开 Chapter/ 下的章节文档', async () => {
        const target = path.join(STORAGE_ROOT, 'press', '剑来', 'Chapter', '01-初见.md')
        registerTextDocument(target, ['# 初见'])

        await openChapterByPath('press/剑来/Chapter/01-初见.md')

        expect(readOpenedDocumentPaths()).toEqual([target])
    })

    it('拒绝非 Chapter 层级、其他模块与越界路径', async () => {
        await expect(openChapterByPath('press/剑来/README.md')).rejects.toThrow('章节路径非法')
        await expect(openChapterByPath('press/剑来/Chapter')).rejects.toThrow('章节路径非法')
        await expect(openChapterByPath('notes/a/Chapter/x.md')).rejects.toThrow('章节路径非法')
        await expect(openChapterByPath('press/../x/Chapter/a.md')).rejects.toThrow('章节路径非法')
        expect(readOpenedDocumentPaths()).toEqual([])
    })
})
