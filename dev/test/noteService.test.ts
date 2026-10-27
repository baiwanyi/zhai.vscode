/**
 * noteService 单元测试：覆盖空笔记落盘位置（含默认存储根回退）、目录创建、写入内容与索引触发，
 * 以及按索引路径打开已有笔记时的路径校验与编辑器调用。
 * 虚拟磁盘、目录与可打开文档由 vscode 测试桩承接，不触达真实文件系统；
 * 断言路径统一用 node:path 规范化，与实现一样规避分隔符差异。
 */
import * as os from 'node:os'
import * as path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
    hasDirectory,
    readFileContent,
    readOpenedDocumentPaths,
    registerTextDocument,
    resetWorkspaceState,
    setConfigValue,
} from './stubs/vscode'
import type { NoteIndexer } from '../../src/modules/note/noteService'
import { createNote, openNoteByPath } from '../../src/modules/note/noteService'

const STORAGE_ROOT = 'd:/vault'

/** 构造记录索引调用的替身，返回被索引的绝对路径列表供断言 */
function createIndexer(): { indexer: NoteIndexer; indexed: string[] } {
    const indexed: string[] = []
    const indexer: NoteIndexer = {
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

describe('createNote', () => {
    it('在存储根的年月目录下落盘并创建目录', async () => {
        const { indexer } = createIndexer()
        const created = await createNote(indexer)
        const directory = created.path.slice(0, created.path.lastIndexOf('/'))
        expect(created.path).toMatch(/^notes\/\d{6}\/[0-9a-f-]{36}\.md$/)
        expect(hasDirectory(path.join(STORAGE_ROOT, directory))).toBe(true)
        expect(readFileContent(path.join(STORAGE_ROOT, created.path))).toContain('# 未命名笔记')
    })

    it('落盘后立即索引，索引路径与返回路径一致', async () => {
        const { indexer, indexed } = createIndexer()
        const created = await createNote(indexer)
        expect(indexed).toEqual([path.join(STORAGE_ROOT, created.path)])
    })

    it('返回标题与写入内容一致', async () => {
        const { indexer } = createIndexer()
        const created = await createNote(indexer)
        expect(created.title).toBe('未命名笔记')
        expect(readFileContent(path.join(STORAGE_ROOT, created.path))).toContain(`# ${created.title}`)
    })

    it('连续创建互不覆盖且路径不同', async () => {
        const { indexer, indexed } = createIndexer()
        const first = await createNote(indexer)
        const second = await createNote(indexer)
        expect(first.path).not.toBe(second.path)
        expect(readFileContent(path.join(STORAGE_ROOT, first.path))).toBeDefined()
        expect(readFileContent(path.join(STORAGE_ROOT, second.path))).toBeDefined()
        expect(indexed).toHaveLength(2)
    })

    it('未配置保存目录时回退到用户主目录下的 .zhai', async () => {
        resetWorkspaceState()
        const { indexer } = createIndexer()
        const created = await createNote(indexer)
        expect(created.uri.fsPath).toBe(path.join(os.homedir(), '.zhai', ...created.path.split('/')))
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
