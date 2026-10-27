/**
 * 章节快照单元测试：覆盖保存通道自动留版与去重、AI 写回前强制留底、按章隔离、
 * 单章恢复的覆盖与留底、脏文档拒绝、越权路径拒绝与过期清理。
 * 虚拟磁盘、目录与已打开文档均由 vscode 测试桩承接，断言一律取自服务返回值。
 * 关键约束：自动通道按章节流，用例只验证首次立即落盘与同内容去重，不等待定时器。
 */
import * as path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import * as vscode from 'vscode'
import {
    readFileContent,
    registerDirtyTextDocument,
    resetWorkspaceState,
    setConfigValue,
    setFileContent,
} from './stubs/vscode'
import { PressSnapshotService } from '../../src/modules/press/snapshot/snapshotService'

const STORAGE_ROOT = 'd:/vault'
const PROJECT_DIR = 'press/剑来'
const CHAPTER_DIR = '02-卷二'
const CHAPTER_FILE = '08-初见.md'
const CHAPTER_PATH = `${PROJECT_DIR}/Chapters/${CHAPTER_DIR}/${CHAPTER_FILE}`

/** 磁盘与快照共用的章节绝对路径 */
function chapterFsPath(fileName = CHAPTER_FILE, volume = CHAPTER_DIR): string {
    return path.join(STORAGE_ROOT, 'press', '剑来', 'Chapters', volume, fileName)
}

/** 构造章节文档的 Uri：走 Uri.file，与服务里按 uri.path 判定归属的路径一致 */
function chapterUri(fileName = CHAPTER_FILE, volume = CHAPTER_DIR): vscode.Uri {
    return vscode.Uri.file(chapterFsPath(fileName, volume))
}

beforeEach(() => {
    resetWorkspaceState()
    setConfigValue('storage.rootPath', STORAGE_ROOT)
    setConfigValue('press.snapshot.enabled', true)
})

describe('保存通道自动留版', () => {
    it('章节保存后立即留一版，正文与元信息成对落盘', async () => {
        const service = new PressSnapshotService()
        setFileContent(chapterFsPath(), '第一章正文')
        await service.recordEditorSave(chapterUri())
        await service.recordEditorSave(chapterUri())
        const chapters = await service.listChapters(PROJECT_DIR)
        expect(chapters).toHaveLength(1)
        expect(chapters[0]?.chapterPath).toBe(CHAPTER_PATH)
        expect(chapters[0]?.volume).toBe(CHAPTER_DIR)
        const versions = await service.listChapterVersions(PROJECT_DIR, CHAPTER_PATH)
        expect(versions).toHaveLength(1)
        expect(versions[0]?.reason).toBe('auto')
        expect(versions[0]?.sizeBytes).toBe(new TextEncoder().encode('第一章正文').byteLength)
    })

    it('内容未变的重复保存不产生新版本', async () => {
        const service = new PressSnapshotService()
        setFileContent(chapterFsPath(), '同一段正文')
        await service.recordEditorSave(chapterUri())
        setFileContent(chapterFsPath(), '同一段正文')
        await service.recordEditorSave(chapterUri())
        const versions = await service.listChapterVersions(PROJECT_DIR, CHAPTER_PATH)
        expect(versions).toHaveLength(1)
    })

    it('章节直接位于 Chapters 下（无卷目录）时同样留版', async () => {
        const service = new PressSnapshotService()
        const flatPath = path.join(STORAGE_ROOT, 'press', '剑来', 'Chapters', '01-前言.md')
        setFileContent(flatPath, '前言正文')
        await service.recordEditorSave(vscode.Uri.file(flatPath))
        const chapters = await service.listChapters(PROJECT_DIR)
        expect(chapters).toHaveLength(1)
        expect(chapters[0]?.chapterPath).toBe(`${PROJECT_DIR}/Chapters/01-前言.md`)
        expect(chapters[0]?.volume).toBe('')
        expect(await service.listChapterVersions(PROJECT_DIR, chapters[0]?.chapterPath ?? '')).toHaveLength(1)
    })

    it('非章节目录的保存事件被忽略', async () => {
        const service = new PressSnapshotService()
        const otherUri = vscode.Uri.file(path.join(STORAGE_ROOT, 'press', '剑来', '设定.md'))
        setFileContent(otherUri.fsPath, '# 设定\n')
        await service.recordEditorSave(otherUri)
        expect(await service.listChapters(PROJECT_DIR)).toHaveLength(0)
    })
})

describe('AI 写回前留底', () => {
    it('强制留一版且来源为 ai-write，内容取写回前的编辑器全文', async () => {
        const service = new PressSnapshotService()
        setFileContent(chapterFsPath(), '磁盘上的旧正文')
        await service.captureChapterBeforeWrite(chapterUri(), '编辑器里写回前的新正文')
        const versions = await service.listChapterVersions(PROJECT_DIR, CHAPTER_PATH)
        expect(versions).toHaveLength(1)
        expect(versions[0]?.reason).toBe('ai-write')
        expect(versions[0]?.sizeBytes).toBe(new TextEncoder().encode('编辑器里写回前的新正文').byteLength)
    })

    it('写回前内容与最新一版相同时不重复留版', async () => {
        const service = new PressSnapshotService()
        await service.captureChapterBeforeWrite(chapterUri(), '同一段正文')
        await service.captureChapterBeforeWrite(chapterUri(), '同一段正文')
        expect(await service.listChapterVersions(PROJECT_DIR, CHAPTER_PATH)).toHaveLength(1)
    })
})

describe('按章隔离', () => {
    it('两章各自维护独立时间线', async () => {
        const service = new PressSnapshotService()
        await service.captureChapterBeforeWrite(chapterUri(), '第二章正文')
        await service.captureChapterBeforeWrite(chapterUri('09-别离.md'), '第九章正文')
        const chapters = await service.listChapters(PROJECT_DIR)
        expect(chapters).toHaveLength(2)
        const first = await service.listChapterVersions(PROJECT_DIR, CHAPTER_PATH)
        const second = await service.listChapterVersions(PROJECT_DIR, `${PROJECT_DIR}/Chapters/${CHAPTER_DIR}/09-别离.md`)
        expect(first).toHaveLength(1)
        expect(second).toHaveLength(1)
    })
})

describe('单章恢复', () => {
    it('覆盖正文、恢复前留底并重建索引', async () => {
        const indexed: string[] = []
        const service = new PressSnapshotService({
            indexFile: (uri): Promise<void> => {
                indexed.push(uri.fsPath)
                return Promise.resolve()
            },
        })
        setFileContent(chapterFsPath(), '原始正文')
        const created = await service.captureChapter(PROJECT_DIR, CHAPTER_PATH, '改前留底')
        expect(created.reason).toBe('manual')
        setFileContent(chapterFsPath(), '被改坏的正文')
        const isRestored = await service.restoreChapter(PROJECT_DIR, CHAPTER_PATH, created.id)
        expect(isRestored).toBe(true)
        expect(readFileContent(chapterFsPath())).toBe('原始正文')
        expect(indexed).toHaveLength(1)
        const versions = await service.listChapterVersions(PROJECT_DIR, CHAPTER_PATH)
        expect(versions).toHaveLength(2)
        expect(versions.some((item) => item.reason === 'restore')).toBe(true)
    })

    it('正文与所选版本一致时返回 false 且不写盘', async () => {
        const service = new PressSnapshotService()
        setFileContent(chapterFsPath(), '同样的正文')
        const created = await service.captureChapter(PROJECT_DIR, CHAPTER_PATH)
        setFileContent(chapterFsPath(), '同样的正文')
        expect(await service.restoreChapter(PROJECT_DIR, CHAPTER_PATH, created.id)).toBe(false)
        expect(await service.listChapterVersions(PROJECT_DIR, CHAPTER_PATH)).toHaveLength(1)
    })

    it('该章在编辑器中有未保存修改时拒绝恢复', async () => {
        const service = new PressSnapshotService()
        setFileContent(chapterFsPath(), '原始正文')
        const created = await service.captureChapter(PROJECT_DIR, CHAPTER_PATH)
        setFileContent(chapterFsPath(), '后续正文')
        registerDirtyTextDocument(chapterFsPath(), ['后续正文'])
        await expect(service.restoreChapter(PROJECT_DIR, CHAPTER_PATH, created.id)).rejects.toThrow('未保存的修改')
        expect(readFileContent(chapterFsPath())).toBe('后续正文')
    })
})

describe('安全与清理', () => {
    it('越权章节路径被拒绝', async () => {
        const service = new PressSnapshotService()
        await expect(
            service.listChapterVersions(PROJECT_DIR, 'press/剑来/Chapters/../../README.md'),
        ).rejects.toThrow()
        await expect(
            service.listChapterVersions(PROJECT_DIR, 'press/其它作品/Chapters/02-卷二/08-初见.md'),
        ).rejects.toThrow('不属于当前作品')
    })

    it('版本数受硬上限约束', async () => {
        const service = new PressSnapshotService()
        for (let index = 0; index < 25; index += 1) {
            await service.captureChapterBeforeWrite(chapterUri(), `第 ${index} 版正文`)
        }
        const versions = await service.listChapterVersions(PROJECT_DIR, CHAPTER_PATH)
        expect(versions.length).toBeLessThanOrEqual(20)
        expect(versions.length).toBeGreaterThan(0)
    })

    it('删除单版只影响该版本', async () => {
        const service = new PressSnapshotService()
        await service.captureChapterBeforeWrite(chapterUri(), '第一版')
        await service.captureChapterBeforeWrite(chapterUri(), '第二版')
        const versions = await service.listChapterVersions(PROJECT_DIR, CHAPTER_PATH)
        const last = versions[versions.length - 1]
        expect(await service.removeChapterVersion(PROJECT_DIR, CHAPTER_PATH, last?.id ?? '')).toBe(true)
        expect(await service.listChapterVersions(PROJECT_DIR, CHAPTER_PATH)).toHaveLength(1)
    })
})
