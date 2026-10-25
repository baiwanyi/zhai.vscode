/**
 * 封面服务单元测试：覆盖合成封面保存（格式与体积校验、落盘命名、自动设为封面）、
 * 设为封面的归属与存在性校验，以及删除当前封面后的回退。
 * 用内存库跑真实 schema 承载封面指针；虚拟磁盘与 mtime 由 vscode 测试桩承接。
 */
import * as path from 'node:path'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import {
    readFileContent,
    resetWorkspaceState,
    setConfigValue,
    setDirectory,
    setFileContent,
    setFileMtime,
} from './stubs/vscode'
import { ensureSchema } from '../src/modules/common/db/schema'
import { PressCoverService } from '../src/modules/imagegen/coverService'
import { PressCoverStore } from '../src/modules/imagegen/db/coverRepository'

const STORAGE_ROOT = 'd:/vault'
const DIR_PATH = 'press/剑来'
const PHOTO_OLD = 'photo-20260101010101-AbCd1234.png'
const COVER_OLD = 'cover-20260101010101.png'
const COVER_NEW = 'cover-20270101010101.png'
/** 合法的合成封面上传负载：宿主只校验前缀与体积，不解析像素 */
const PNG_DATA_URL = `data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`

let store: PressCoverStore
let service: PressCoverService

/** 作品目录下某个图片目录里的文件绝对路径 */
function imageFsPath(dirName: string, fileName: string): string {
    return path.join(STORAGE_ROOT, 'press', '剑来', dirName, fileName)
}

/** 作品内图片的相对路径 */
function imagePath(dirName: string, fileName: string): string {
    return `${DIR_PATH}/${dirName}/${fileName}`
}

/** 登记图片文件并返回其相对路径；目录必须显式登记，否则 readDirectory 视为不存在 */
function addImage(dirName: string, fileName: string): string {
    setDirectory(path.join(STORAGE_ROOT, 'press', '剑来', dirName))
    setFileContent(imageFsPath(dirName, fileName), 'binary')
    return imagePath(dirName, fileName)
}

beforeEach(() => {
    resetWorkspaceState()
    setConfigValue('storage.rootPath', STORAGE_ROOT)
    const db = new Database(':memory:')
    ensureSchema(db)
    store = new PressCoverStore(db)
    service = new PressCoverService(db)
})

describe('save', () => {
    it('落盘为 Cover/cover-*.png 并自动设为作品封面', async () => {
        const result = await service.save({ dirPath: DIR_PATH, dataUrl: PNG_DATA_URL }, (uri) => uri.fsPath)

        expect(result.cover.path.startsWith(`${DIR_PATH}/Cover/cover-`)).toBe(true)
        expect(result.cover.path.endsWith('.png')).toBe(true)
        expect(store.read(DIR_PATH)).toBe(result.cover.path)
        expect(readFileContent(path.join(STORAGE_ROOT, ...result.cover.path.split('/')))).toBe('png-bytes')
    })

    it('拒绝非 PNG data URL', async () => {
        await expect(
            service.save({ dirPath: DIR_PATH, dataUrl: 'data:image/jpeg;base64,AAAA' }, (uri) => uri.fsPath),
        ).rejects.toThrow('封面图片格式非法')
    })

    it('拒绝没有像素数据的空负载', async () => {
        await expect(
            service.save({ dirPath: DIR_PATH, dataUrl: 'data:image/png;base64,' }, (uri) => uri.fsPath),
        ).rejects.toThrow('封面图片为空')
    })
})

describe('select', () => {
    it('校验归属与文件存在后写入指针', async () => {
        const target = addImage('Images', PHOTO_OLD)

        const result = await service.select({ dirPath: DIR_PATH, path: target })

        expect(result.selectedId).toBe('photo-20260101010101-AbCd1234')
        expect(store.read(DIR_PATH)).toBe(target)
    })

    it('文件不存在时拒绝', async () => {
        await expect(service.select({ dirPath: DIR_PATH, path: imagePath('Images', PHOTO_OLD) })).rejects.toThrow(
            '封面文件已不存在',
        )
    })

    it('路径不属于该作品时拒绝', async () => {
        await expect(service.select({ dirPath: DIR_PATH, path: 'press/别的/Images/manual.png' })).rejects.toThrow(
            '封面路径非法',
        )
    })
})

describe('remove', () => {
    it('删除当前封面后回退到剩余最新一张', async () => {
        addImage('Cover', COVER_OLD)
        addImage('Cover', COVER_NEW)
        setFileMtime(imageFsPath('Cover', COVER_OLD), 100)
        setFileMtime(imageFsPath('Cover', COVER_NEW), 200)
        store.write(DIR_PATH, imagePath('Cover', COVER_OLD))

        const result = await service.remove({ dirPath: DIR_PATH, path: imagePath('Cover', COVER_OLD) })

        expect(result).toEqual({ removed: true, selectedId: 'cover-20270101010101' })
        expect(store.read(DIR_PATH)).toBe(imagePath('Cover', COVER_NEW))
    })

    it('删除的不是当前封面时指针保持不变', async () => {
        addImage('Cover', COVER_OLD)
        addImage('Cover', COVER_NEW)
        store.write(DIR_PATH, imagePath('Cover', COVER_NEW))

        const result = await service.remove({ dirPath: DIR_PATH, path: imagePath('Cover', COVER_OLD) })

        expect(result).toEqual({ removed: true, selectedId: 'cover-20270101010101' })
    })
})
