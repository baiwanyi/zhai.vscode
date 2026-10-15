/**
 * noteService 单元测试：覆盖空笔记落盘位置、目录创建、写入内容与索引触发。
 * 虚拟磁盘与目录登记由 vscode 测试桩承接，不触达真实文件系统。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { hasDirectory, readFileContent, resetWorkspaceState, setConfigValue } from '@/tests/stubs/vscode'
import { createNote } from './noteService'
import type { NoteIndexer } from './noteService'

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
        expect(hasDirectory(`${STORAGE_ROOT}/${directory}`)).toBe(true)
        expect(readFileContent(`${STORAGE_ROOT}/${created.path}`)).toContain('# 未命名笔记')
    })

    it('落盘后立即索引，索引路径与返回路径一致', async () => {
        const { indexer, indexed } = createIndexer()
        const created = await createNote(indexer)
        expect(indexed).toEqual([`${STORAGE_ROOT}/${created.path}`])
    })

    it('返回标题与写入内容一致', async () => {
        const { indexer } = createIndexer()
        const created = await createNote(indexer)
        expect(created.title).toBe('未命名笔记')
        expect(readFileContent(`${STORAGE_ROOT}/${created.path}`)).toContain(`title: "${created.title}"`)
    })

    it('连续创建互不覆盖且路径不同', async () => {
        const { indexer, indexed } = createIndexer()
        const first = await createNote(indexer)
        const second = await createNote(indexer)
        expect(first.path).not.toBe(second.path)
        expect(readFileContent(`${STORAGE_ROOT}/${first.path}`)).toBeDefined()
        expect(readFileContent(`${STORAGE_ROOT}/${second.path}`)).toBeDefined()
        expect(indexed).toHaveLength(2)
    })
})
