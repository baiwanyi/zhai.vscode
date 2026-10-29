/**
 * 封面服务单元测试：候选只取该作品出处下的普通图（photo / unknown），按落盘时间降序、上限截断，并回读当前封面。
 * 用两张内存库分别承载 press.db（封面指针）与 media.db（媒体索引），schema 走真实实现；
 * 关键约束：角色图与条目图不进候选——它们属于角色卡与条目弹窗的封面，不应出现在作品封面里。
 */
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetWorkspaceState, setConfigValue } from './stubs/vscode'
import type { MediaDatabase } from '../../src/modules/media/db/connection'
import type { MediaRecord } from '../../src/modules/media/mediaRepository'
import { ensureSchema } from '../../src/modules/common/db/schema'
import { PressCoverService } from '../../src/modules/imagegen/coverService'
import { ensureMediaSchema } from '../../src/modules/media/db/schema'
import { insertMedia } from '../../src/modules/media/mediaRepository'
import { PressCoverStore } from '../../src/modules/media/pressCoverStore'

const STORAGE_ROOT = 'd:/vault'
const DIR_PATH = 'press/剑来'
const PHOTO_OLD = '20260101010101AbCd12'
const PHOTO_NEW = '20270101010101EfGh34'
const PORTRAIT = '20260101010102IjKl56'
/** 与 coverService 的候选上限保持一致：超过该数量应被截断 */
const CANDIDATE_LIMIT = 60

let store: PressCoverStore
let mediaDb: Database.Database
let service: PressCoverService

/** 媒体记录工厂：只覆盖断言用到的字段 */
function mediaOf(overrides: Partial<MediaRecord> & { id: string }): MediaRecord {
    return {
        path: `images/202601/${overrides.id}.png`,
        ext: 'png',
        byteSize: 1024,
        month: '2026-01',
        createdAt: '2026-01-01T00:00:00.000Z',
        scope: 'press',
        origin: 'generate',
        kind: 'photo',
        pressPath: DIR_PATH,
        pressName: '剑来',
        characterId: null,
        characterName: null,
        loreKind: null,
        loreId: null,
        loreName: null,
        prompt: null,
        ratio: null,
        style: null,
        enhancedFrom: null,
        ...overrides,
    }
}

/** 测试用 URL 转换：直接返回磁盘路径，断言里就能比对 */
function toFsPath(uri: { fsPath: string }): string {
    return uri.fsPath
}

beforeEach(() => {
    resetWorkspaceState()
    setConfigValue('storage.rootPath', STORAGE_ROOT)
    const pressDb = new Database(':memory:')
    ensureSchema(pressDb)
    store = new PressCoverStore(pressDb)
    const media = new Database(':memory:')
    ensureMediaSchema(media)
    mediaDb = media
    const database: MediaDatabase = { db: media, filePath: ':memory:', degraded: false, isRecovered: false }
    service = new PressCoverService({ openDatabase: (): MediaDatabase => database, coverStore: store })
})

describe('list', () => {
    it('只列举该作品出处下的普通图，并按落盘时间降序', () => {
        insertMedia(mediaDb, mediaOf({ id: PHOTO_OLD, createdAt: '2026-01-01T00:00:00.000Z' }))
        insertMedia(mediaDb, mediaOf({ id: PHOTO_NEW, createdAt: '2027-01-01T00:00:00.000Z' }))

        const result = service.list({ dirPath: DIR_PATH }, toFsPath)

        expect(result.covers.map((item) => item.id)).toEqual([PHOTO_NEW, PHOTO_OLD])
        expect(result.total).toBe(2)
    })

    it('角色图与条目图不进作品封面候选', () => {
        insertMedia(mediaDb, mediaOf({ id: PHOTO_OLD }))
        insertMedia(
            mediaDb,
            mediaOf({
                id: PORTRAIT,
                kind: 'portrait',
                characterId: '10428736',
                characterName: '林清',
            }),
        )

        const result = service.list({ dirPath: DIR_PATH }, toFsPath)

        expect(result.covers.map((item) => item.id)).toEqual([PHOTO_OLD])
    })

    it('其他作品出处下的图片不混入当前作品', () => {
        insertMedia(mediaDb, mediaOf({ id: PHOTO_OLD }))
        insertMedia(mediaDb, mediaOf({ id: PHOTO_NEW, pressPath: 'press/雪中', pressName: '雪中' }))

        const result = service.list({ dirPath: DIR_PATH }, toFsPath)

        expect(result.covers.map((item) => item.id)).toEqual([PHOTO_OLD])
    })

    it('候选按上限截断，总数仍返回真实张数', () => {
        for (let index = 0; index < CANDIDATE_LIMIT + 5; index += 1) {
            const id = String(index).padStart(20, '0')
            insertMedia(mediaDb, mediaOf({ id, createdAt: new Date(Date.now() + index * 1000).toISOString() }))
        }

        const result = service.list({ dirPath: DIR_PATH }, toFsPath)

        expect(result.covers).toHaveLength(CANDIDATE_LIMIT)
        expect(result.total).toBe(CANDIDATE_LIMIT + 5)
    })

    it('当前封面从指针回读：设置过的封面出现在 selectedId', () => {
        insertMedia(mediaDb, mediaOf({ id: PHOTO_OLD }))
        store.write(DIR_PATH, `images/202601/${PHOTO_OLD}.png`)

        const result = service.list({ dirPath: DIR_PATH }, toFsPath)

        expect(result.selectedId).toBe(PHOTO_OLD)
    })

    it('未设置封面时 selectedId 为 null', () => {
        insertMedia(mediaDb, mediaOf({ id: PHOTO_OLD }))

        const result = service.list({ dirPath: DIR_PATH }, toFsPath)

        expect(result.selectedId).toBeNull()
    })
})
