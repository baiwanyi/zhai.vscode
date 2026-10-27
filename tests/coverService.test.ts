/**
 * 封面服务单元测试：覆盖候选只收 Images 下的普通图片、按修改时间排序、上限截断与当前封面回读。
 * 用内存库跑真实 schema 承载封面指针；虚拟磁盘与 mtime 由 vscode 测试桩承接。
 */
import * as path from 'node:path'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetWorkspaceState, setConfigValue, setDirectory, setFileContent, setFileMtime } from './stubs/vscode'
import { ensureSchema } from '../src/modules/common/db/schema'
import { PressCoverService } from '../src/modules/imagegen/coverService'
import { PressCoverStore } from '../src/modules/imagegen/db/coverRepository'

const STORAGE_ROOT = 'd:/vault'
const DIR_PATH = 'press/剑来'
const PHOTO_OLD = 'photo-20260101010101-AbCd1234.png'
const PHOTO_NEW = 'photo-20270101010101-EfGh5678.png'
/** 历史合成封面：只存在于旧 Cover 目录，不应再进候选 */
const LEGACY_COVER = 'cover-20250101010101.png'
/** 与 coverService 的候选上限保持一致：超过该数量应被截断 */
const CANDIDATE_LIMIT = 60

let store: PressCoverStore
let service: PressCoverService

/** 作品目录下某个图片目录里的文件绝对路径 */
function imageFsPath(dirName: string, fileName: string): string {
    return path.join(STORAGE_ROOT, 'press', '剑来', dirName, fileName)
}

/** 登记图片文件并写入修改时间；目录必须显式登记，否则 readDirectory 视为不存在 */
function addImage(dirName: string, fileName: string, mtime: number): void {
    setDirectory(path.join(STORAGE_ROOT, 'press', '剑来', dirName))
    setFileContent(imageFsPath(dirName, fileName), 'binary')
    setFileMtime(imageFsPath(dirName, fileName), mtime)
}

beforeEach(() => {
    resetWorkspaceState()
    setConfigValue('storage.rootPath', STORAGE_ROOT)
    const db = new Database(':memory:')
    ensureSchema(db)
    store = new PressCoverStore(db)
    service = new PressCoverService(db)
})

describe('list', () => {
    it('只列举 Images 候选并按修改时间降序', async () => {
        addImage('Images', PHOTO_OLD, 200)
        addImage('Images', PHOTO_NEW, 300)

        const result = await service.list({ dirPath: DIR_PATH }, (uri) => uri.fsPath)

        expect(result.covers.map((item) => item.id)).toEqual([
            'photo-20270101010101-EfGh5678',
            'photo-20260101010101-AbCd1234',
        ])
        expect(result.total).toBe(2)
        expect(result.selectedId).toBeNull()
    })

    it('跳过旧 Cover 目录、角色图与手工图', async () => {
        addImage('Cover', LEGACY_COVER, 100)
        addImage('Images', 'portrait-20260101010101-abcd1234.png', 200)
        addImage('Images', 'manual.png', 300)

        const result = await service.list({ dirPath: DIR_PATH }, (uri) => uri.fsPath)

        expect(result.covers).toEqual([])
        expect(result.total).toBe(0)
    })

    it('已设封面时回传该封面的标识', async () => {
        addImage('Images', PHOTO_OLD, 200)
        addImage('Images', PHOTO_NEW, 300)
        store.write(DIR_PATH, `press/剑来/Images/${PHOTO_OLD}`)

        const result = await service.list({ dirPath: DIR_PATH }, (uri) => uri.fsPath)

        expect(result.selectedId).toBe('photo-20260101010101-AbCd1234')
    })

    it('作品目录不存在时返回空列表', async () => {
        const result = await service.list({ dirPath: DIR_PATH }, (uri) => uri.fsPath)

        expect(result).toEqual({ covers: [], selectedId: null, total: 0 })
    })

    it('候选超过上限时截断到 60 张，total 仍为真实总数', async () => {
        for (let index = 0; index < CANDIDATE_LIMIT + 5; index += 1) {
            addImage('Images', `photo-20260101010101-${String(index).padStart(8, '0')}.png`, index)
        }

        const result = await service.list({ dirPath: DIR_PATH }, (uri) => uri.fsPath)

        expect(result.covers).toHaveLength(CANDIDATE_LIMIT)
        expect(result.total).toBe(CANDIDATE_LIMIT + 5)
    })
})
