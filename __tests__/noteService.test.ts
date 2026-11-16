/**
 * noteService 单元测试：覆盖空笔记落盘位置（含默认存储根回退）、目录创建、写入内容与索引触发，
 * 按索引路径打开已有笔记时的路径校验与编辑器调用，以及移除笔记前的归属校验与脏文档拦截。
 * 虚拟磁盘、目录与可打开文档由 vscode 测试桩承接，不触达真实文件系统；
 * 断言路径统一用 node:path 规范化，与实现一样规避分隔符差异。
 */
import * as os from 'node:os'
import * as path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import * as vscode from 'vscode'
import {
    hasDirectory,
    readFileContent,
    readOpenedDocumentPaths,
    registerDirtyTextDocument,
    registerTextDocument,
    resetWorkspaceState,
    setConfigValue,
    setFileContent,
} from './stubs/vscode'
import type { NoteIndexer } from '../src/modules/note/noteService'
import {
    assertNoteSaved,
    assertRemovableNote,
    createNote,
    isNoteExisting,
    openNoteByPath,
} from '../src/modules/note/noteService'

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
    it('在未分类笔记本下落盘并创建目录', async () => {
        const { indexer } = createIndexer()
        const created = await createNote(indexer)
        const directory = created.path.slice(0, created.path.lastIndexOf('/'))
        expect(created.path).toMatch(/^notes\/未分类\/未命名笔记 1\.md$/)
        expect(hasDirectory(path.join(STORAGE_ROOT, directory))).toBe(true)
        expect(readFileContent(path.join(STORAGE_ROOT, created.path))).toContain('# 未命名笔记 1')
    })

    it('可指定目标笔记本，目录不存在时自动创建', async () => {
        const { indexer } = createIndexer()
        const created = await createNote(indexer, 'notes/AMZ')
        expect(created.path).toBe('notes/AMZ/未命名笔记 1.md')
        expect(hasDirectory(path.join(STORAGE_ROOT, 'notes/AMZ'))).toBe(true)
    })

    it('拒绝越界目录，不产生任何落盘', async () => {
        const { indexer, indexed } = createIndexer()
        await expect(createNote(indexer, 'notes/../secret')).rejects.toThrow('笔记本目录非法')
        await expect(createNote(indexer, 'press/剑来')).rejects.toThrow('笔记本目录非法')
        expect(indexed).toEqual([])
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

describe('assertRemovableNote', () => {
    it('接受 notes/ 下的 Markdown 文档', () => {
        expect(assertRemovableNote('notes/202610/a.md')).toEqual(['notes', '202610', 'a.md'])
        expect(assertRemovableNote('notes/a.md')).toEqual(['notes', 'a.md'])
    })

    it('拒绝 notes/ 之外的归属与非 Markdown 文件', () => {
        expect(() => assertRemovableNote('press/剑来/Chapters/01-初遇.md')).toThrow('不是可删除的笔记文档')
        expect(() => assertRemovableNote('notes/202610/a.txt')).toThrow('不是可删除的笔记文档')
    })

    it('拒绝上跳片段与含盘符、反斜杠的路径', () => {
        expect(() => assertRemovableNote('notes/../../secret.md')).toThrow('笔记路径非法')
        expect(() => assertRemovableNote('C:/notes/a.md')).toThrow('笔记路径非法')
        expect(() => assertRemovableNote('notes\\a.md')).toThrow('笔记路径非法')
    })
})

describe('isNoteExisting', () => {
    it('磁盘存在返回 true，缺失返回 false', async () => {
        const target = path.join(STORAGE_ROOT, 'notes/202610/a.md')
        setFileContent(target, '# 标题')
        await expect(isNoteExisting('notes/202610/a.md')).resolves.toBe(true)
        await expect(isNoteExisting('notes/202610/missing.md')).resolves.toBe(false)
    })
})

describe('assertNoteSaved', () => {
    it('已保存放行，有未保存修改时拒绝', () => {
        const target = path.join(STORAGE_ROOT, 'notes/202610/a.md')
        registerTextDocument(target, ['# 标题'])
        expect(() => assertNoteSaved(vscode.Uri.file(target), 'notes/202610/a.md')).not.toThrow()
        registerDirtyTextDocument(target, ['# 标题（未保存）'])
        expect(() => assertNoteSaved(vscode.Uri.file(target), 'notes/202610/a.md')).toThrow('笔记有未保存的修改')
    })
})
