/**
 * 媒体引用扫描用例：验证正文里的图片写法都能回查到媒体记录。
 * 索引走内存 media.db（真实 schema），磁盘由 vscode 测试桩承接；
 * 关键约束：@zhai/ 引用必须与相对路径引用等价地落库，否则删除图片时看不到「被谁引用」；
 * 越界的 @zhai/../ 引用必须计入 stale 且不落库，避免把存储根外的路径当成本库图片。
 */
import * as path from 'node:path'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { registerDirtyTextDocument, resetWorkspaceState, setConfigValue, setDirectory, setFileContent } from './stubs/vscode'
import type { MediaRecord } from '../src/modules/media/mediaRepository'
import { ensureMediaSchema } from '../src/modules/media/db/schema'
import { rescanReferences } from '../src/modules/media/mediaReferenceService'
import { insertMedia, insertUsage } from '../src/modules/media/mediaRepository'

const STORAGE_ROOT = 'd:/vault'
const DIR_PATH = 'press/剑来'
const PROJECT_DIR = path.join(STORAGE_ROOT, 'press', '剑来')
const CHAPTERS_DIR = path.join(PROJECT_DIR, 'Chapters')
const MEDIA_ID = '20261023214848e3g8VP'
const MEDIA_PATH = `images/202610/${MEDIA_ID}.png`

let db: Database.Database

/** 媒体记录工厂：只覆盖断言用到的字段 */
function mediaOf(id: string): MediaRecord {
    return {
        id,
        path: MEDIA_PATH,
        ext: 'png',
        byteSize: 1024,
        month: '2026-10',
        createdAt: '2026-10-23T21:48:48.000Z',
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
    }
}

/** 登记一篇章节文档：正文原样写入 */
function putChapter(name: string, body: string): void {
    setDirectory(CHAPTERS_DIR)
    setFileContent(path.join(CHAPTERS_DIR, name), body)
}

beforeEach(() => {
    resetWorkspaceState()
    setConfigValue('storage.rootPath', STORAGE_ROOT)
    setDirectory(path.join(STORAGE_ROOT, 'press'))
    setDirectory(PROJECT_DIR)
    db = new Database(':memory:')
    ensureMediaSchema(db)
    insertMedia(db, mediaOf(MEDIA_ID))
})

describe('正文图片引用解析', () => {
    it('@zhai/ 开头的引用能回查到媒体并落库', async () => {
        putChapter('第1章.md', `正文\n\n![雪夜](@zhai/${MEDIA_PATH})\n`)

        const outcome = await rescanReferences(db, () => null, DIR_PATH)

        const rows = db.prepare('SELECT * FROM media_usage WHERE media_id = ?').all(MEDIA_ID) as {
            ref_type: string
            ref_path: string
        }[]
        expect(outcome.usages).toBe(1)
        expect(outcome.stale).toBe(0)
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({
            ref_type: 'chapter',
            ref_path: `${DIR_PATH}/Chapters/第1章.md`,
        })
    })

    it('在线图库引用既不落库也不计 stale', async () => {
        // 同一篇里混入一张 unsplash 的图：它是另一个库的资产，查不到不代表失效
        putChapter('第2章.md', `正文\n\n![山脊](@zhai/unsplash/202611/Kq2WnB6x9eA.jpg)\n![雪夜](@zhai/${MEDIA_PATH})\n`)

        const outcome = await rescanReferences(db, () => null, DIR_PATH)

        expect(outcome.usages).toBe(1)
        expect(outcome.stale).toBe(0)
    })

    it('相对路径引用保持原有行为', async () => {
        putChapter('第2章.md', `![雪夜](../../../${MEDIA_PATH})\n`)

        const outcome = await rescanReferences(db, () => null, DIR_PATH)

        expect(outcome.usages).toBe(1)
        expect(outcome.stale).toBe(0)
    })

    it('越界的 @zhai/ 引用记为 stale 且不落库', async () => {
        putChapter('第3章.md', '![越界](@zhai/../secret.png)\n')

        const outcome = await rescanReferences(db, () => null, DIR_PATH)

        expect(outcome.usages).toBe(0)
        expect(outcome.stale).toBe(1)
        expect(db.prepare('SELECT COUNT(*) AS total FROM media_usage').get()).toMatchObject({ total: 0 })
    })

    it('编辑器里未保存的文档跳过重建，插入时登记的引用不被抹掉', async () => {
        // 磁盘上还是插入前的旧正文，编辑器里已经引用了这张图：脏文档必须以编辑器为准
        const chapterPath = `${DIR_PATH}/Chapters/第4章.md`
        putChapter('第4章.md', '正文\n')
        insertUsage(db, MEDIA_ID, {
            refType: 'chapter',
            refPath: chapterPath,
            refScope: 'storage',
            refId: null,
            refTitle: '第4章',
            refAnchor: null,
        })
        registerDirtyTextDocument(path.join(CHAPTERS_DIR, '第4章.md'), ['正文', '', `![雪夜](@zhai/${MEDIA_PATH})`])

        const outcome = await rescanReferences(db, () => null, DIR_PATH)

        const rows = db.prepare('SELECT * FROM media_usage WHERE media_id = ?').all(MEDIA_ID) as { ref_path: string }[]
        expect(outcome.usages).toBe(0)
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({ ref_path: chapterPath })
    })

    it('作品封面指针失效时清掉旧引用，不留下指向已丢失图片的封面记录', async () => {
        insertUsage(db, MEDIA_ID, {
            refType: 'press_cover',
            refPath: DIR_PATH,
            refScope: 'storage',
            refId: null,
            refTitle: '剑来',
            refAnchor: null,
        })

        // 指针还指着一张已被移走的图：查不到媒体时应当解绑，而不是静默跳过
        await rescanReferences(db, () => `images/202610/${'0'.repeat(16)}.png`, DIR_PATH)

        const rows = db.prepare("SELECT COUNT(*) AS total FROM media_usage WHERE ref_type = 'press_cover'").get()
        expect(rows).toMatchObject({ total: 0 })
    })

    it('作品根级的自建文档同样参与引用重建', async () => {
        // 不在任何白名单里的文档：作者在作品目录里自建的素材笔记，同样要能算出「被谁引用」
        setFileContent(path.join(PROJECT_DIR, '素材.md'), `![雪夜](@zhai/${MEDIA_PATH})\n`)

        const outcome = await rescanReferences(db, () => null, DIR_PATH)

        expect(outcome.usages).toBe(1)
        expect(db.prepare('SELECT ref_path FROM media_usage WHERE media_id = ?').get(MEDIA_ID)).toMatchObject({
            ref_path: `${DIR_PATH}/素材.md`,
        })
    })

    it('外部文档不在了就清掉它的引用行', async () => {
        // 存储根外的文档只可能在插入时登记，文件被删或移走后必须由重扫解绑，否则引用数永远虚高
        const externalPath = path.join('d:/elsewhere', '随笔.md')
        insertUsage(db, MEDIA_ID, {
            refType: 'external',
            refPath: externalPath,
            refScope: 'absolute',
            refId: null,
            refTitle: '随笔',
            refAnchor: null,
        })

        await rescanReferences(db, () => null, DIR_PATH)

        const rows = db.prepare("SELECT COUNT(*) AS total FROM media_usage WHERE ref_type = 'external'").get()
        expect(rows).toMatchObject({ total: 0 })
    })
})
