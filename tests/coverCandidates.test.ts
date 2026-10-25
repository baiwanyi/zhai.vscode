/**
 * 封面画廊候选单元测试：覆盖命名白名单（cover-* / photo-* 收录、角色图与手工图排除）
 * 与「截断到上限并回传总数」的口径。
 * 用内存库跑真实 schema 承载封面指针；虚拟磁盘由 vscode 测试桩承接，mtime 统一为 0，故不断言顺序。
 */
import * as path from 'node:path'
import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetWorkspaceState, setConfigValue, setDirectory, setFileContent } from './stubs/vscode'
import { ensureSchema } from '../src/modules/common/db/schema'
import { PressCoverService } from '../src/modules/imagegen/coverService'

const STORAGE_ROOT = 'd:/vault'
const DIR_PATH = 'press/剑来'
/** 与 coverService 的候选上限保持一致：超过该数量应被截断 */
const CANDIDATE_LIMIT = 60

let service: PressCoverService

/** 作品目录下某个图片目录的绝对路径 */
function dirFsPath(dirName: string): string {
    return path.join(STORAGE_ROOT, 'press', '剑来', dirName)
}

/** 在图片目录下登记一个文件 */
function addFile(dirName: string, fileName: string): void {
    setDirectory(dirFsPath(dirName))
    setFileContent(path.join(dirFsPath(dirName), fileName), 'binary')
}

/** 列举画廊候选：URL 转换对断言无意义，直接给绝对路径 */
async function listCandidates(): Promise<{ ids: string[]; total: number }> {
    const result = await service.list({ dirPath: DIR_PATH }, (uri) => uri.fsPath)
    return { ids: result.covers.map((cover) => cover.id), total: result.total }
}

beforeEach(() => {
    resetWorkspaceState()
    setConfigValue('storage.rootPath', STORAGE_ROOT)
    setDirectory(path.join(STORAGE_ROOT, 'press', '剑来'))
    const db = new Database(':memory:')
    ensureSchema(db)
    service = new PressCoverService(db)
})

describe('PressCoverService.list', () => {
    it('只收合成封面与生图产物，角色图与手工图不进画廊', async () => {
        addFile('Cover', 'cover-20260101010101.png')
        addFile('Cover', 'manual.png')
        addFile('Images', 'photo-20260101010101-AbCd1234.png')
        addFile('Images', 'portrait-20260101010101-12345678.png')
        addFile('Images', 'manual.png')

        const { ids, total } = await listCandidates()

        expect(ids.sort()).toEqual(['cover-20260101010101', 'photo-20260101010101-AbCd1234'])
        expect(total).toBe(2)
    })

    it('候选超过上限时截断到 60 张，total 仍为真实总数', async () => {
        for (let index = 0; index < CANDIDATE_LIMIT + 5; index += 1) {
            addFile('Images', `photo-20260101010101-${String(index).padStart(8, '0')}.png`)
        }

        const { ids, total } = await listCandidates()

        expect(ids).toHaveLength(CANDIDATE_LIMIT)
        expect(total).toBe(CANDIDATE_LIMIT + 5)
    })

    it('没有候选图时返回空列表与零总数', async () => {
        const { ids, total } = await listCandidates()

        expect(ids).toEqual([])
        expect(total).toBe(0)
    })
})
