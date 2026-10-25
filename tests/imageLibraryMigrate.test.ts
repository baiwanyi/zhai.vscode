/**
 * 旧目录迁移单元测试：覆盖搬图计数、同名跳过、侧车随行，以及作品封面指针的目录前缀改写。
 * 用内存库跑真实 schema 承载封面指针；虚拟磁盘由 vscode 测试桩承接，断言取文件内容与库内指针。
 * 关键约束：封面指针值形如 press/{作品名}/{目录}/{文件名}，用例按完整路径断言，防止只改目录段的回归。
 */
import * as path from 'node:path'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import {
    hasDirectory,
    readFileContent,
    resetWorkspaceState,
    setConfigValue,
    setDirectory,
    setFileContent,
} from './stubs/vscode'
import { ensureSchema } from '../src/modules/common/db/schema'
import { PressCoverStore } from '../src/modules/imagegen/db/coverRepository'
import { ImageLibraryService } from '../src/modules/imagegen/imageLibraryService'

const STORAGE_ROOT = 'd:/vault'
const DIR_PATH = 'press/剑来'
const COVER_IMAGE = 'cover-20260101010101.png'
const PHOTO_IMAGE = 'photo-20260101010101-AbCd1234.png'

let db: Database.Database
let store: PressCoverStore
let service: ImageLibraryService

/** 作品目录下某个图片目录的绝对路径 */
function dirFsPath(dirName: string): string {
    return path.join(STORAGE_ROOT, 'press', '剑来', dirName)
}

/** 图片目录里的文件绝对路径 */
function imageFsPath(dirName: string, fileName: string): string {
    return path.join(dirFsPath(dirName), fileName)
}

/** 登记一张带侧车的图片 */
function addImageWithSidecar(dirName: string, fileName: string): void {
    setDirectory(dirFsPath(dirName))
    setFileContent(imageFsPath(dirName, fileName), 'binary')
    setFileContent(imageFsPath(dirName, fileName.replace(/\.[^.]+$/u, '.json')), '{"prompt":"雪夜"}')
}

beforeEach(() => {
    resetWorkspaceState()
    setConfigValue('storage.rootPath', STORAGE_ROOT)
    setDirectory(path.join(STORAGE_ROOT, 'press', '剑来'))
    db = new Database(':memory:')
    ensureSchema(db)
    store = new PressCoverStore(db)
    service = new ImageLibraryService(store)
})

describe('migrate', () => {
    it('把旧目录图片搬进 Images，侧车一并跟随', async () => {
        addImageWithSidecar('Cover', COVER_IMAGE)

        const result = await service.migrate({ dirPath: DIR_PATH })

        expect(result).toEqual({ moved: 1, skipped: 0, coverUpdated: false })
        expect(readFileContent(imageFsPath('Images', COVER_IMAGE))).toBe('binary')
        expect(readFileContent(imageFsPath('Images', 'cover-20260101010101.json'))).toBe('{"prompt":"雪夜"}')
        expect(readFileContent(imageFsPath('Cover', COVER_IMAGE))).toBeUndefined()
        expect(readFileContent(imageFsPath('Cover', 'cover-20260101010101.json'))).toBeUndefined()
    })

    it('目标已有同名图片时跳过，两侧都保留，侧车不动', async () => {
        addImageWithSidecar('Cover', COVER_IMAGE)
        setFileContent(imageFsPath('Images', COVER_IMAGE), '既有')

        const result = await service.migrate({ dirPath: DIR_PATH })

        expect(result).toEqual({ moved: 0, skipped: 1, coverUpdated: false })
        expect(readFileContent(imageFsPath('Images', COVER_IMAGE))).toBe('既有')
        expect(readFileContent(imageFsPath('Cover', COVER_IMAGE))).toBe('binary')
        expect(readFileContent(imageFsPath('Cover', 'cover-20260101010101.json'))).toBe('{"prompt":"雪夜"}')
    })

    it('封面指针在旧目录时改写为 Images 完整路径', async () => {
        addImageWithSidecar('Cover', COVER_IMAGE)
        store.write(DIR_PATH, `${DIR_PATH}/Cover/${COVER_IMAGE}`)

        const result = await service.migrate({ dirPath: DIR_PATH })

        expect(result.coverUpdated).toBe(true)
        expect(store.read(DIR_PATH)).toBe(`${DIR_PATH}/Images/${COVER_IMAGE}`)
    })

    it('封面指针已在 Images 时视为无需改写，且不抛错', async () => {
        setFileContent(imageFsPath('Images', PHOTO_IMAGE), 'binary')
        store.write(DIR_PATH, `${DIR_PATH}/Images/${PHOTO_IMAGE}`)

        const result = await service.migrate({ dirPath: DIR_PATH })

        expect(result).toEqual({ moved: 0, skipped: 0, coverUpdated: false })
        expect(store.read(DIR_PATH)).toBe(`${DIR_PATH}/Images/${PHOTO_IMAGE}`)
    })

    it('没有旧目录时直接返回零计数', async () => {
        const result = await service.migrate({ dirPath: DIR_PATH })

        expect(result).toEqual({ moved: 0, skipped: 0, coverUpdated: false })
    })

    it('旧目录搬空后一并删除，不留空目录', async () => {
        addImageWithSidecar('Cover', COVER_IMAGE)

        await service.migrate({ dirPath: DIR_PATH })

        expect(hasDirectory(dirFsPath('Cover'))).toBe(false)
    })

    it('旧目录仍有非图片文件时保留目录', async () => {
        addImageWithSidecar('Cover', COVER_IMAGE)
        setFileContent(path.join(dirFsPath('Cover'), 'note.txt'), 'x')

        await service.migrate({ dirPath: DIR_PATH })

        expect(hasDirectory(dirFsPath('Cover'))).toBe(true)
        expect(readFileContent(path.join(dirFsPath('Cover'), 'note.txt'))).toBe('x')
    })
})
