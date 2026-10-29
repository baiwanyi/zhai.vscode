/**
 * 媒体插入用例：验证「插入到编辑器」写进正文的引用形态与引用落库。
 * 复用约定：编辑器、虚拟磁盘与编辑记录由 vscode 测试桩承接，媒体库走内存 media.db 与真实 schema；
 * 关键约束：正文一律写 @zhai/ 存储根引用（与文档所在目录无关），文档或作品目录移动后链接仍有效；
 * 同一文档重复插入同一张图须回传 duplicated 且引用表只留一行，避免引用数虚高。
 */
import * as path from 'node:path'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import {
    createSelection,
    createTextDocument,
    createTextEditor,
    readInsertedTexts,
    resetWorkspaceState,
    setConfigValue,
    setFileContent,
    window,
} from './stubs/vscode'
import type { MediaDatabase } from '../../src/modules/media/db/connection'
import type { MediaRecord } from '../../src/modules/media/mediaRepository'
import { ensureMediaSchema } from '../../src/modules/media/db/schema'
import { MediaLibraryService } from '../../src/modules/media/mediaLibraryService'
import { insertMedia } from '../../src/modules/media/mediaRepository'
import { PressCoverStore } from '../../src/modules/media/pressCoverStore'

const STORAGE_ROOT = 'd:/vault'
const MEDIA_ID = '20261023214848e3g8VP'
const MEDIA_PATH = `images/202610/${MEDIA_ID}.png`
const IMAGE_PATH = path.join(STORAGE_ROOT, 'images', '202610', `${MEDIA_ID}.png`)
const CHAPTER_PATH = path.join(STORAGE_ROOT, 'press', '剑来', 'Chapters', '第1章.md')
const ZHAI_REFERENCE = `@zhai/${MEDIA_PATH}`

let db: Database.Database
let service: MediaLibraryService

/** 媒体记录工厂：只覆盖插入用到的字段，路径可替换以构造文件缺失场景 */
function mediaOf(id: string, mediaPath = MEDIA_PATH): MediaRecord {
    return {
        id,
        path: mediaPath,
        ext: 'png',
        byteSize: 1024,
        month: '2026-10',
        createdAt: '2026-10-23T21:48:48.000Z',
        scope: 'press',
        origin: 'generate',
        kind: 'photo',
        pressPath: 'press/剑来',
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
    }
}

/** 把一篇文档挂成活动编辑器：光标停在首行行首 */
function focusDocument(fsPath: string, lines: string[]): void {
    const document = createTextDocument(lines, fsPath)
    window.activeTextEditor = createTextEditor(document, [createSelection(0, 0, 0, 0)])
}

/** 读取某张图的引用行：ref_type / ref_scope / ref_path 三项即可判定登记口径 */
function readUsages(mediaId: string): { ref_type: string; ref_scope: string; ref_path: string }[] {
    return db.prepare('SELECT ref_type, ref_scope, ref_path FROM media_usage WHERE media_id = ?').all(mediaId) as {
        ref_type: string
        ref_scope: string
        ref_path: string
    }[]
}

beforeEach(() => {
    resetWorkspaceState()
    setConfigValue('storage.rootPath', STORAGE_ROOT)
    setFileContent(IMAGE_PATH, 'png')
    db = new Database(':memory:')
    ensureMediaSchema(db)
    insertMedia(db, mediaOf(MEDIA_ID))
    service = new MediaLibraryService({
        openDatabase: (): MediaDatabase => ({ db, filePath: ':memory:', degraded: false, isRecovered: false }),
        coverStore: new PressCoverStore(db),
    })
})

describe('插入到编辑器', () => {
    it('写入 @zhai/ 存储根引用，不按文档目录换算路径', async () => {
        focusDocument(CHAPTER_PATH, ['## 第1章', ''])

        const result = await service.insert({ id: MEDIA_ID })

        expect(result).toMatchObject({ inserted: true, refPath: ZHAI_REFERENCE, duplicated: false })
        expect(readInsertedTexts()).toEqual([`![剑来](${ZHAI_REFERENCE})`])
        expect(readUsages(MEDIA_ID)).toEqual([
            { ref_type: 'chapter', ref_scope: 'storage', ref_path: 'press/剑来/Chapters/第1章.md' },
        ])
    })

    it('存储根外的文档同样写 @zhai/ 引用，引用按绝对路径登记', async () => {
        const outsidePath = path.join('d:/outside', '散记.md')
        focusDocument(outsidePath, ['# 散记'])

        const result = await service.insert({ id: MEDIA_ID })

        expect(result).toMatchObject({ inserted: true, refPath: ZHAI_REFERENCE })
        expect(readInsertedTexts()).toEqual([`![剑来](${ZHAI_REFERENCE})`])
        expect(readUsages(MEDIA_ID)).toEqual([{ ref_type: 'external', ref_scope: 'absolute', ref_path: outsidePath }])
    })

    it('没有可插入的编辑器时返回 no-editor 且不写正文', async () => {
        const result = await service.insert({ id: MEDIA_ID })

        expect(result).toEqual({ inserted: false, reason: 'no-editor' })
        expect(readInsertedTexts()).toEqual([])
        expect(readUsages(MEDIA_ID)).toEqual([])
    })

    it('同一文档重复插入同一张图回传 duplicated，引用只留一行', async () => {
        focusDocument(CHAPTER_PATH, ['## 第1章', ''])

        const first = await service.insert({ id: MEDIA_ID })
        const second = await service.insert({ id: MEDIA_ID })

        expect(first).toMatchObject({ inserted: true, duplicated: false })
        expect(second).toMatchObject({ inserted: true, duplicated: true })
        expect(readInsertedTexts()).toHaveLength(2)
        expect(readUsages(MEDIA_ID)).toHaveLength(1)
    })

    it('图片文件缺失时拒绝插入且不动正文', async () => {
        const missingId = '20261023214849Ab3dEf'
        insertMedia(db, mediaOf(missingId, `images/202610/${missingId}.png`))
        focusDocument(CHAPTER_PATH, ['## 第1章', ''])

        await expect(service.insert({ id: missingId })).rejects.toThrow('图片文件已不存在，请刷新列表')
        expect(readInsertedTexts()).toEqual([])
        expect(readUsages(missingId)).toEqual([])
    })

    it('非 Markdown 文档不插入', async () => {
        const document = createTextDocument(['## 第1章', ''], CHAPTER_PATH)
        const editor = createTextEditor(document, [createSelection(0, 0, 0, 0)])
        window.activeTextEditor = { ...editor, document: { ...document, languageId: 'plaintext' } }

        const result = await service.insert({ id: MEDIA_ID })

        expect(result).toEqual({ inserted: false, reason: 'not-markdown' })
        expect(readInsertedTexts()).toEqual([])
    })
})
