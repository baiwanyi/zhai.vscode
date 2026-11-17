/**
 * 单文件快照单元测试：覆盖笔记/散文档保存后自动留版与去重、手动留版、写回前留底、推送留底、
 * 恢复的覆盖与留底、越权路径拒绝与非 Markdown 忽略。
 * 虚拟磁盘与已打开文档由 vscode 测试桩承接，断言一律取自服务返回值与文件内容。
 * 关键约束：自动通道按文档流，用例只验证首次立即落盘与同内容去重，不等待定时器。
 */
import * as path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import * as vscode from 'vscode'
import { readFileContent, resetWorkspaceState, setConfigValue, setFileContent } from './stubs/vscode'
import { PressSnapshotService } from '../src/modules/press/snapshot/snapshotService'

const STORAGE_ROOT = 'd:/vault'
const NOTE_PATH = 'notes/随笔/夏夜.md'

/** 文档在磁盘上的绝对路径 */
function docFsPath(relativePath = NOTE_PATH): string {
    return path.join(STORAGE_ROOT, ...relativePath.split('/'))
}

/** 文档 Uri：走 Uri.file，与服务里按 fsPath 换算 docPath 的口径一致 */
function docUri(relativePath = NOTE_PATH): vscode.Uri {
    return vscode.Uri.file(docFsPath(relativePath))
}

beforeEach(() => {
    resetWorkspaceState()
    setConfigValue('storage.rootPath', STORAGE_ROOT)
    setConfigValue('press.snapshot.enabled', true)
})

describe('保存通道自动留版', () => {
    it('笔记保存后立即留一版，来源为 auto', async () => {
        const service = new PressSnapshotService()
        setFileContent(docFsPath(), '第一段正文')
        await service.recordEditorSave(docUri())
        const versions = await service.listDocVersions(NOTE_PATH)
        expect(versions).toHaveLength(1)
        expect(versions[0]?.reason).toBe('auto')
        expect(versions[0]?.title).toBe('夏夜')
    })

    it('同内容重复保存不产生新版本', async () => {
        const service = new PressSnapshotService()
        setFileContent(docFsPath(), '同一段正文')
        await service.recordEditorSave(docUri())
        setFileContent(docFsPath(), '同一段正文')
        await service.recordEditorSave(docUri())
        expect(await service.listDocVersions(NOTE_PATH)).toHaveLength(1)
    })

    it('非 Markdown 文件既不进时间线，查询也被拒绝', async () => {
        const service = new PressSnapshotService()
        setFileContent(docFsPath('notes/随笔/素材.txt'), '纯文本')
        await service.recordEditorSave(docUri('notes/随笔/素材.txt'))
        await expect(service.listDocVersions('notes/随笔/素材.txt')).rejects.toThrow('不是 Markdown')
    })
})

describe('手动留版与留底', () => {
    it('手动留版记录备注与 manual 来源', async () => {
        const service = new PressSnapshotService()
        setFileContent(docFsPath(), '手动正文')
        const created = await service.captureDoc(NOTE_PATH, '改完开头')
        expect(created.reason).toBe('manual')
        expect(created.label).toBe('改完开头')
        expect(await service.listDocVersions(NOTE_PATH)).toHaveLength(1)
    })

    it('写回前留底立即写入且来源为 ai-write', async () => {
        const service = new PressSnapshotService()
        setFileContent(docFsPath(), '磁盘上的旧正文')
        await service.captureChapterBeforeWrite(docUri(), '编辑器里写回前的新正文')
        const versions = await service.listDocVersions(NOTE_PATH)
        expect(versions).toHaveLength(1)
        expect(versions[0]?.reason).toBe('ai-write')
        expect(versions[0]?.sizeBytes).toBe(new TextEncoder().encode('编辑器里写回前的新正文').byteLength)
    })

    it('推送留底立即写入且来源为 push', async () => {
        const service = new PressSnapshotService()
        setFileContent(docFsPath('wechat/wx123/post/202611170900/标题.md'), '推送正文')
        await service.capturePushDoc('wechat/wx123/post/202611170900/标题.md', '群发推送')
        const versions = await service.listDocVersions('wechat/wx123/post/202611170900/标题.md')
        expect(versions).toHaveLength(1)
        expect(versions[0]?.reason).toBe('push')
        expect(versions[0]?.label).toBe('群发推送')
    })
})

describe('恢复', () => {
    it('覆盖正文并给恢复前的内容留一版', async () => {
        const service = new PressSnapshotService()
        setFileContent(docFsPath(), '原始正文')
        const created = await service.captureDoc(NOTE_PATH)
        setFileContent(docFsPath(), '后续正文')
        expect(await service.restoreDoc(NOTE_PATH, created.id)).toBe(true)
        expect(readFileContent(docFsPath())).toBe('原始正文')
        const versions = await service.listDocVersions(NOTE_PATH)
        expect(versions).toHaveLength(2)
        expect(versions.some((version) => version.reason === 'restore')).toBe(true)
    })

    it('正文与所选版本一致时返回 false 且不写盘', async () => {
        const service = new PressSnapshotService()
        setFileContent(docFsPath(), '同样的正文')
        const created = await service.captureDoc(NOTE_PATH)
        expect(await service.restoreDoc(NOTE_PATH, created.id)).toBe(false)
        expect(await service.listDocVersions(NOTE_PATH)).toHaveLength(1)
    })
})

describe('安全边界', () => {
    it('含上跳片段的文档路径被拒绝', async () => {
        const service = new PressSnapshotService()
        await expect(service.captureDoc('notes/../../etc/passwd.md')).rejects.toThrow()
    })

    it('快照目录自身的保存不进时间线', async () => {
        const service = new PressSnapshotService()
        const snapshotDocPath = 'Snapshots/docs/notes/夏夜/20261117-090000-abcdef.md'
        setFileContent(docFsPath(snapshotDocPath), '副本正文')
        await service.recordEditorSave(docUri(snapshotDocPath))
        expect(await service.listDocVersions(snapshotDocPath)).toHaveLength(0)
    })
})
