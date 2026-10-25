/**
 * 图片库服务单元测试：覆盖三目录归类与计数、按生成时间排序、删除后的封面回退与侧车清理、
 * 角色图删除回传的下一个封面，以及详情侧车的读取与损坏降级。
 * 用内存库跑真实 schema 承载封面指针；虚拟磁盘由 vscode 测试桩承接，断言取返回值与文件内容。
 */
import * as path from 'node:path'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ImageLibraryResult } from '@shared/types/imagegen'
import {
    readDeletedPaths,
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
const PHOTO_OLD = 'photo-20260101010101-AbCd1234.png'
const PHOTO_NEW = 'photo-20270101010101-AbCd1234.png'
const PORTRAIT_OLD = 'portrait-20260101010101-12345678.png'
const PORTRAIT_NEW = 'portrait-20270101010101-12345678.png'

let store: PressCoverStore
let service: ImageLibraryService

/** 作品目录下某个图片目录里的文件绝对路径 */
function imageFsPath(dirName: string, fileName: string): string {
    return path.join(STORAGE_ROOT, 'press', '剑来', dirName, fileName)
}

/** 登记图片文件，可选同时登记同名侧车；目录必须显式登记，否则 readDirectory 视为不存在 */
function addImage(dirName: string, fileName: string, sidecar?: string): void {
    setDirectory(path.join(STORAGE_ROOT, 'press', '剑来', dirName))
    setFileContent(imageFsPath(dirName, fileName), 'binary')
    if (sidecar !== undefined) {
        setFileContent(imageFsPath(dirName, fileName.replace(/\.[^.]+$/u, '.json')), sidecar)
    }
}

/** 作品内图片的相对路径 */
function imagePath(dirName: string, fileName: string): string {
    return `${DIR_PATH}/${dirName}/${fileName}`
}

/** 列举图库：URL 转换对断言无意义，直接给绝对路径 */
async function listLibrary(): Promise<ImageLibraryResult> {
    return service.list({ dirPath: DIR_PATH }, (uri) => uri.fsPath)
}

beforeEach(() => {
    resetWorkspaceState()
    setConfigValue('storage.rootPath', STORAGE_ROOT)
    const db = new Database(':memory:')
    ensureSchema(db)
    store = new PressCoverStore(db)
    service = new ImageLibraryService(store)
})

describe('list', () => {
    it('合并三目录并按标识归类，counts 与封面指针同步给出', async () => {
        addImage('Images', PHOTO_OLD)
        addImage('Images', PORTRAIT_OLD)
        addImage('Images', 'manual.png')
        addImage('Cover', 'cover-20260101010101.png')
        store.write(DIR_PATH, imagePath('Images', PHOTO_OLD))

        const result = await listLibrary()

        expect(result.images).toHaveLength(4)
        expect(result.counts).toEqual({ portrait: 1, photo: 2, orphan: 1 })
        expect(result.coverSelectedId).toBe('photo-20260101010101-AbCd1234')
    })

    it('按文件名时间戳降序，最新在前', async () => {
        addImage('Images', PHOTO_OLD)
        addImage('Images', PHOTO_NEW)

        const result = await listLibrary()

        expect(result.images.map((image) => image.id)).toEqual([
            'photo-20270101010101-AbCd1234',
            'photo-20260101010101-AbCd1234',
        ])
    })
})

describe('remove', () => {
    it('删除图片与同名侧车，作品封面回退到剩余最新一张', async () => {
        addImage('Images', PHOTO_OLD, '{"prompt":"雪夜"}')
        addImage('Images', PHOTO_NEW)
        store.write(DIR_PATH, imagePath('Images', PHOTO_OLD))

        const result = await service.remove({ dirPath: DIR_PATH, path: imagePath('Images', PHOTO_OLD) })

        expect(result).toEqual({
            removed: true,
            coverSelectedId: 'photo-20270101010101-AbCd1234',
            characterId: null,
            nextPortraitId: null,
        })
        expect(readDeletedPaths()).toContain(imageFsPath('Images', 'photo-20260101010101-AbCd1234.json'))
        expect(readFileContent(imageFsPath('Images', 'photo-20260101010101-AbCd1234.json'))).toBeUndefined()
    })

    it('删除角色图时回传角色标识与该角色剩余最新一张', async () => {
        addImage('Images', PORTRAIT_OLD)
        addImage('Images', PORTRAIT_NEW)

        const result = await service.remove({ dirPath: DIR_PATH, path: imagePath('Images', PORTRAIT_NEW) })

        expect(result.characterId).toBe('12345678')
        expect(result.nextPortraitId).toBe('portrait-20260101010101-12345678')
    })

    it('路径不属于该作品时拒绝删除', async () => {
        await expect(service.remove({ dirPath: DIR_PATH, path: 'press/别的/Images/manual.png' })).rejects.toThrow(
            '图片路径非法',
        )
    })
})

describe('batchRemove', () => {
    it('一次删除多张并直接回传新图库，侧车一并清理', async () => {
        addImage('Images', PHOTO_OLD, '{"prompt":"雪夜"}')
        addImage('Images', PHOTO_NEW)

        const result = await service.batchRemove(
            { dirPath: DIR_PATH, paths: [imagePath('Images', PHOTO_OLD), imagePath('Images', PHOTO_NEW)] },
            (uri) => uri.fsPath,
        )

        expect(result.removals).toEqual([
            { path: imagePath('Images', PHOTO_OLD), removed: true },
            { path: imagePath('Images', PHOTO_NEW), removed: true },
        ])
        expect(result.library.images).toEqual([])
        expect(readFileContent(imageFsPath('Images', 'photo-20260101010101-AbCd1234.json'))).toBeUndefined()
    })

    it('删掉当前封面时指针回退到剩余最新一张', async () => {
        addImage('Images', PHOTO_OLD)
        addImage('Images', PHOTO_NEW)
        store.write(DIR_PATH, imagePath('Images', PHOTO_NEW))

        const result = await service.batchRemove(
            { dirPath: DIR_PATH, paths: [imagePath('Images', PHOTO_NEW)] },
            (uri) => uri.fsPath,
        )

        expect(result.library.coverSelectedId).toBe('photo-20260101010101-AbCd1234')
        expect(store.read(DIR_PATH)).toBe(imagePath('Images', PHOTO_OLD))
    })

    it('任一非法路径即整单拒绝，不删除任何图片', async () => {
        addImage('Images', PHOTO_OLD)

        await expect(
            service.batchRemove(
                { dirPath: DIR_PATH, paths: [imagePath('Images', PHOTO_OLD), 'press/别的/Images/manual.png'] },
                (uri) => uri.fsPath,
            ),
        ).rejects.toThrow('图片路径非法')

        expect(readFileContent(imageFsPath('Images', PHOTO_OLD))).toBe('binary')
    })

    it('空路径列表直接拒绝', async () => {
        await expect(service.batchRemove({ dirPath: DIR_PATH, paths: [] }, (uri) => uri.fsPath)).rejects.toThrow(
            '缺少待删除的图片路径',
        )
    })
})

describe('readDetail', () => {
    it('读取同名侧车字段，空字段回落 null', async () => {
        addImage(
            'Images',
            PHOTO_OLD,
            JSON.stringify({
                prompt: '雪夜',
                ratio: '3:4',
                style: 'anime',
                characterId: null,
                createdAt: '2026-01-01',
            }),
        )

        const detail = await service.readDetail({ dirPath: DIR_PATH, path: imagePath('Images', PHOTO_OLD) })

        expect(detail.prompt).toBe('雪夜')
        expect(detail.ratio).toBe('3:4')
        expect(detail.style).toBe('anime')
        expect(detail.enhancedFrom).toBeNull()
        expect(detail.createdAt).toBe('2026-01-01')
    })

    it('侧车缺失或内容不合法时全字段为 null，不抛错', async () => {
        addImage('Images', PHOTO_OLD)
        addImage('Images', PHOTO_NEW, '{不是 JSON')

        await expect(service.readDetail({ dirPath: DIR_PATH, path: imagePath('Images', PHOTO_OLD) })).resolves.toEqual({
            prompt: null,
            ratio: null,
            style: null,
            characterId: null,
            enhancedFrom: null,
            createdAt: null,
        })
        await expect(service.readDetail({ dirPath: DIR_PATH, path: imagePath('Images', PHOTO_NEW) })).resolves.toEqual({
            prompt: null,
            ratio: null,
            style: null,
            characterId: null,
            enhancedFrom: null,
            createdAt: null,
        })
    })
})
