/**
 * indexService 单元测试：覆盖单文件索引写入与存储根相对路径归一化的路径口径。
 * 用内存库跑真实 schema，文件内容与目录由 vscode 测试桩的虚拟磁盘承接；
 * 用例以「存储根盘符大写、文件 Uri 盘符小写」构造大小写差异，锁定相对路径的剥离逻辑。
 */
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import * as vscode from 'vscode'
import { resetWorkspaceState, setConfigValue, setFileContent } from '@/__test__/stubs/vscode'
import type { IndexStatus } from '../modules/common/indexer/indexService'
import { ensureSchema } from '../modules/common/db/schema'
import { IndexService } from '../modules/common/indexer/indexService'

const STORAGE_ROOT = 'D:\\vault'

let db: Database.Database
let service: IndexService

beforeEach(() => {
    resetWorkspaceState()
    setConfigValue('storage.rootPath', STORAGE_ROOT)
    db = new Database(':memory:')
    ensureSchema(db)
    service = new IndexService(db, new vscode.EventEmitter<IndexStatus>())
})

/** 读取库中唯一的记录路径 */
function readOnlyPath(): string {
    return (db.prepare('SELECT path FROM files').get() as { path: string }).path
}

describe('IndexService.indexFile', () => {
    it('文件 Uri 与存储根盘符大小写不同时仍写入相对路径', async () => {
        setFileContent('d:\\vault\\notes\\a.md', '# 标题\n正文\n')
        await service.indexFile(vscode.Uri.file('d:\\vault\\notes\\a.md'))
        expect(readOnlyPath()).toBe('notes/a.md')
    })

    it('文件位于存储根之外时保留绝对路径，不做错误剥离', async () => {
        setFileContent('d:\\other\\a.md', '# 标题\n')
        await service.indexFile(vscode.Uri.file('d:\\other\\a.md'))
        expect(readOnlyPath()).toBe('d:/other/a.md')
    })
})

describe('IndexService.toRelativePath', () => {
    it('存储根内剥离前缀，且不受盘符大小写影响', () => {
        expect(service.toRelativePath(vscode.Uri.file('d:\\vault\\notes\\a.md'))).toBe('notes/a.md')
    })

    it('存储根之外原样返回绝对路径，供调用方自行判别', () => {
        expect(service.toRelativePath(vscode.Uri.file('d:\\other\\a.md'))).toBe('d:/other/a.md')
    })
})
