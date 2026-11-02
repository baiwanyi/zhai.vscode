/**
 * noteRenameService 单元测试：覆盖保存后按标题重命名的判定与副作用。
 * 虚拟磁盘与编辑器由 vscode 测试桩承接，索引与置顶用记录型替身，断言路径统一经 node:path 规范化。
 * 重点覆盖：标题一致时不动作、改名后索引与置顶跟着走、目标被占用时顺延序号、非笔记目录与无标题一律跳过。
 */
import * as path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
    createTextDocument,
    createTextEditor,
    readFileContent,
    resetWorkspaceState,
    setConfigValue,
    setFileContent,
    window,
} from './stubs/vscode'
import type { NoteRenameIndexer, NoteRenamePins } from '../src/modules/note/noteRenameService'
import { NoteRenameService } from '../src/modules/note/noteRenameService'

const STORAGE_ROOT = 'd:/vault'
const NOTE_DIR_PATH = path.join(STORAGE_ROOT, 'notes/202610')

/** 记录索引与置顶调用：断言重命名后旧记录被清、新记录被建、置顶路径同步迁移 */
function createRecorder(): {
    indexer: NoteRenameIndexer
    pins: NoteRenamePins
    removed: string[]
    indexed: string[]
    moved: Array<{ previousPath: string; nextPath: string }>
    activeRenamed: string[]
} {
    const removed: string[] = []
    const indexed: string[] = []
    const moved: Array<{ previousPath: string; nextPath: string }> = []
    const activeRenamed: string[] = []
    const indexer: NoteRenameIndexer = {
        // 与 IndexService.toRelativePath 同口径：统一正斜杠后再剥离存储根
        toRelativePath: (uri) => uri.fsPath.replace(/\\/gu, '/').replace(`${STORAGE_ROOT}/`, ''),
        indexFile: (uri) => {
            indexed.push(uri.fsPath)
            return Promise.resolve()
        },
        removeFile: (relativePath) => {
            removed.push(relativePath)
        },
    }
    const pins: NoteRenamePins = {
        renamePath: (previousPath, nextPath) => {
            moved.push({ previousPath, nextPath })
            return Promise.resolve()
        },
    }
    return { indexer, pins, removed, indexed, moved, activeRenamed }
}

beforeEach(() => {
    resetWorkspaceState()
    setConfigValue('storage.rootPath', STORAGE_ROOT)
})

describe('handleSave', () => {
    it('文件名与标题一致时不重命名', async () => {
        const recorder = createRecorder()
        const filePath = path.join(NOTE_DIR_PATH, '会议记录.md')
        setFileContent(filePath, '# 会议记录\n')
        const document = createTextDocument(['# 会议记录'], filePath)
        const service = new NoteRenameService(recorder.indexer, recorder.pins, (nextPath) => {
            recorder.activeRenamed.push(nextPath)
        })

        await service.handleSave(document)

        expect(recorder.removed).toEqual([])
        expect(recorder.indexed).toEqual([])
        expect(readFileContent(filePath)).toBe('# 会议记录\n')
    })

    it('标题变化后重命名文件，并收敛索引与置顶', async () => {
        const recorder = createRecorder()
        const filePath = path.join(NOTE_DIR_PATH, '未命名笔记 1.md')
        const targetPath = path.join(NOTE_DIR_PATH, '会议记录.md')
        setFileContent(filePath, '# 会议记录\n')
        window.activeTextEditor = undefined
        const document = createTextDocument(['# 会议记录'], filePath)
        const service = new NoteRenameService(recorder.indexer, recorder.pins, () => undefined)

        await service.handleSave(document)

        expect(readFileContent(filePath)).toBeUndefined()
        expect(readFileContent(targetPath)).toBe('# 会议记录\n')
        expect(recorder.removed).toEqual(['notes/202610/未命名笔记 1.md'])
        expect(recorder.indexed).toEqual([targetPath])
        expect(recorder.moved).toEqual([
            { previousPath: 'notes/202610/未命名笔记 1.md', nextPath: 'notes/202610/会议记录.md' },
        ])
    })

    it('目标名已被占用时顺延序号', async () => {
        const recorder = createRecorder()
        const filePath = path.join(NOTE_DIR_PATH, '旧标题.md')
        setFileContent(filePath, '# 会议记录\n')
        setFileContent(path.join(NOTE_DIR_PATH, '会议记录.md'), '# 别人\n')
        setFileContent(path.join(NOTE_DIR_PATH, '会议记录 2.md'), '# 别人 2\n')
        const document = createTextDocument(['# 会议记录'], filePath)
        const service = new NoteRenameService(recorder.indexer, recorder.pins, () => undefined)

        await service.handleSave(document)

        expect(readFileContent(path.join(NOTE_DIR_PATH, '会议记录 3.md'))).toBe('# 会议记录\n')
        expect(readFileContent(filePath)).toBeUndefined()
    })

    it('非 notes 目录下的文档不处理', async () => {
        const recorder = createRecorder()
        const filePath = path.join(STORAGE_ROOT, 'press/我的作品/第1章.md')
        setFileContent(filePath, '# 另一个标题\n')
        const document = createTextDocument(['# 另一个标题'], filePath)
        const service = new NoteRenameService(recorder.indexer, recorder.pins, () => undefined)

        await service.handleSave(document)

        expect(recorder.removed).toEqual([])
        expect(readFileContent(filePath)).toBe('# 另一个标题\n')
    })

    it('没有一级标题时保留现有文件名', async () => {
        const recorder = createRecorder()
        const filePath = path.join(NOTE_DIR_PATH, '随手记.md')
        setFileContent(filePath, '只有正文\n')
        const document = createTextDocument(['只有正文'], filePath)
        const service = new NoteRenameService(recorder.indexer, recorder.pins, () => undefined)

        await service.handleSave(document)

        expect(recorder.removed).toEqual([])
        expect(readFileContent(filePath)).toBe('只有正文\n')
    })

    it('被改名的正是活跃文档时回报新路径', async () => {
        const recorder = createRecorder()
        const filePath = path.join(NOTE_DIR_PATH, '旧标题.md')
        setFileContent(filePath, '# 新标题\n')
        const document = createTextDocument(['# 新标题'], filePath)
        window.activeTextEditor = createTextEditor(document)
        const service = new NoteRenameService(recorder.indexer, recorder.pins, (nextPath) => {
            recorder.activeRenamed.push(nextPath)
        })

        await service.handleSave(document)

        expect(recorder.activeRenamed).toEqual(['notes/202610/新标题.md'])
    })
})
