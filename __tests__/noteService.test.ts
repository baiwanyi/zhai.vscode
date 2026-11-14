/**
 * noteService 单元测试：覆盖空笔记落盘位置（含默认存储根回退）、目录创建、写入内容与索引触发，
 * 按索引路径打开已有笔记时的路径校验与编辑器调用，以及删除笔记的归属校验、脏文档拦截与索引收敛。
 * 虚拟磁盘、目录与可打开文档由 vscode 测试桩承接，不触达真实文件系统；
 * 断言路径统一用 node:path 规范化，与实现一样规避分隔符差异。
 */
import * as os from 'node:os'
import * as path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
    hasDirectory,
    readDeletedPaths,
    readFileContent,
    readOpenedDocumentPaths,
    registerDirtyTextDocument,
    registerTextDocument,
    resetWorkspaceState,
    setConfigValue,
    setFileContent,
    setTrashAvailable,
} from './stubs/vscode'
import type { NoteIndexer } from '../src/modules/note/noteService'
import { createNote, deleteNote, openNoteByPath } from '../src/modules/note/noteService'

const STORAGE_ROOT = 'd:/vault'

/** 构造记录索引调用的替身：indexed 收集被索引的绝对路径，removedFiles 收集按完整路径清理的记录 */
function createIndexer(): { indexer: NoteIndexer; indexed: string[]; removedFiles: string[] } {
    const indexed: string[] = []
    const removedFiles: string[] = []
    const indexer: NoteIndexer = {
        indexFile: (uri) => {
            indexed.push(uri.fsPath)
            return Promise.resolve()
        },
        removeFile: (relativePath) => {
            removedFiles.push(relativePath)
        },
    }
    return { indexer, indexed, removedFiles }
}

beforeEach(() => {
    resetWorkspaceState()
    setConfigValue('storage.rootPath', STORAGE_ROOT)
})

describe('createNote', () => {
    it('在存储根的年月目录下落盘并创建目录', async () => {
        const { indexer } = createIndexer()
        const created = await createNote(indexer)
        const directory = created.path.slice(0, created.path.lastIndexOf('/'))
        expect(created.path).toMatch(/^notes\/\d{6}\/未命名笔记 1\.md$/)
        expect(hasDirectory(path.join(STORAGE_ROOT, directory))).toBe(true)
        expect(readFileContent(path.join(STORAGE_ROOT, created.path))).toContain('# 未命名笔记 1')
    })

    it('落盘后立即索引，索引路径与返回路径一致', async () => {
        const { indexer, indexed } = createIndexer()
        const created = await createNote(indexer)
        expect(indexed).toEqual([path.join(STORAGE_ROOT, created.path)])
    })

    it('返回标题与写入内容一致', async () => {
        const { indexer } = createIndexer()
        const created = await createNote(indexer)
        expect(created.title).toBe('未命名笔记 1')
        expect(readFileContent(path.join(STORAGE_ROOT, created.path))).toContain(`# ${created.title}`)
    })

    it('连续创建互不覆盖且序号顺延', async () => {
        const { indexer, indexed } = createIndexer()
        const first = await createNote(indexer)
        const second = await createNote(indexer)
        expect(first.path).not.toBe(second.path)
        expect(first.path).toMatch(/未命名笔记 1\.md$/)
        expect(second.path).toMatch(/未命名笔记 2\.md$/)
        expect(readFileContent(path.join(STORAGE_ROOT, first.path))).toBeDefined()
        expect(readFileContent(path.join(STORAGE_ROOT, second.path))).toBeDefined()
        expect(indexed).toHaveLength(2)
    })

    it('未配置保存目录时回退到用户主目录下的 .zhai，盘符统一小写', async () => {
        resetWorkspaceState()
        const { indexer } = createIndexer()
        const created = await createNote(indexer)
        const expected = path.join(os.homedir(), '.zhai', ...created.path.split('/'))
        expect(created.uri.fsPath).toBe(expected.replace(/^[A-Za-z]:/, (drive) => drive.toLowerCase()))
    })
})

describe('openNoteByPath', () => {
    it('按存储根拼装绝对路径并交由编辑器打开', async () => {
        const target = path.join(STORAGE_ROOT, 'notes/202610/a.md')
        registerTextDocument(target, ['# 标题', '', '正文'])
        await openNoteByPath('notes/202610/a.md')
        expect(readOpenedDocumentPaths()).toEqual([target])
    })

    it('拒绝上跳片段，不触达编辑器', async () => {
        await expect(openNoteByPath('../secret.md')).rejects.toThrow('笔记路径非法')
        expect(readOpenedDocumentPaths()).toEqual([])
    })

    it('拒绝含盘符或反斜杠的路径片段', async () => {
        await expect(openNoteByPath('C:/secret.md')).rejects.toThrow('笔记路径非法')
        await expect(openNoteByPath('notes\\a.md')).rejects.toThrow('笔记路径非法')
    })

    it('目标文件缺失时把读取错误上抛', async () => {
        await expect(openNoteByPath('notes/missing.md')).rejects.toThrow('ENOENT')
    })

    it('兼容索引库历史记录里的绝对路径形态', async () => {
        const target = path.join(STORAGE_ROOT, 'notes/202610/a.md')
        registerTextDocument(target, ['# 标题'])
        await openNoteByPath('/d:/vault/notes/202610/a.md')
        expect(readOpenedDocumentPaths()).toEqual([target])
    })

    it('拒绝存储根之外的绝对路径', async () => {
        await expect(openNoteByPath('/d:/other/notes/a.md')).rejects.toThrow('不在存储根内')
        expect(readOpenedDocumentPaths()).toEqual([])
    })
})

describe('deleteNote', () => {
    it('删除笔记：移入回收站、清理索引并从磁盘移除', async () => {
        const { indexer, removedFiles } = createIndexer()
        const target = path.join(STORAGE_ROOT, 'notes/202610/a.md')
        setFileContent(target, '# 标题')

        const outcome = await deleteNote(indexer, 'notes/202610/a.md')

        expect(outcome).toBe('trash')
        expect(readDeletedPaths()).toEqual([target])
        expect(removedFiles).toEqual(['notes/202610/a.md'])
        expect(readFileContent(target)).toBeUndefined()
    })

    it('回收站不可用时降级永久删除，仍清理索引', async () => {
        const { indexer, removedFiles } = createIndexer()
        const target = path.join(STORAGE_ROOT, 'notes/202610/a.md')
        setFileContent(target, '# 标题')
        setTrashAvailable(false)

        const outcome = await deleteNote(indexer, 'notes/202610/a.md')

        expect(outcome).toBe('permanent')
        expect(readDeletedPaths()).toEqual([target])
        expect(removedFiles).toEqual(['notes/202610/a.md'])
    })

    it('拒绝 notes/ 之外归属的路径，不产生删除调用', async () => {
        const { indexer, removedFiles } = createIndexer()
        const pressFile = path.join(STORAGE_ROOT, 'press/剑来/Chapters/01-初遇.md')
        setFileContent(pressFile, '# 初遇')

        await expect(deleteNote(indexer, 'press/剑来/Chapters/01-初遇.md')).rejects.toThrow('不是可删除的笔记文档')
        await expect(deleteNote(indexer, 'notes/202610/a.txt')).rejects.toThrow('不是可删除的笔记文档')
        expect(readDeletedPaths()).toEqual([])
        expect(removedFiles).toEqual([])
    })

    it('拒绝上跳片段与含盘符、反斜杠的路径', async () => {
        const { indexer } = createIndexer()

        await expect(deleteNote(indexer, 'notes/../../secret.md')).rejects.toThrow('笔记路径非法')
        await expect(deleteNote(indexer, 'C:/notes/a.md')).rejects.toThrow('笔记路径非法')
        await expect(deleteNote(indexer, 'notes\\a.md')).rejects.toThrow('笔记路径非法')
        expect(readDeletedPaths()).toEqual([])
    })

    it('磁盘文件缺失时报错，不清理索引', async () => {
        const { indexer, removedFiles } = createIndexer()

        await expect(deleteNote(indexer, 'notes/202610/missing.md')).rejects.toThrow('笔记文件不存在')
        expect(readDeletedPaths()).toEqual([])
        expect(removedFiles).toEqual([])
    })

    it('文档有未保存修改时拒绝删除，磁盘文件与索引都保留', async () => {
        const { indexer, removedFiles } = createIndexer()
        const target = path.join(STORAGE_ROOT, 'notes/202610/a.md')
        setFileContent(target, '# 标题')
        registerDirtyTextDocument(target, ['# 标题（未保存）'])

        await expect(deleteNote(indexer, 'notes/202610/a.md')).rejects.toThrow('笔记有未保存的修改')
        expect(readDeletedPaths()).toEqual([])
        expect(removedFiles).toEqual([])
        expect(readFileContent(target)).toBe('# 标题')
    })
})
